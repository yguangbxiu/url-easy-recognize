(() => {
  if (globalThis.__URL_EASY_TAB_SWITCHER__) return;
  globalThis.__URL_EASY_TAB_SWITCHER__ = true;

  const SETTINGS_KEY = "settings";
  const PANEL_WIDTH = 560;
  const PANEL_MAX_HEIGHT = 420;
  const PANEL_MIN_HEIGHT = 160;
  const VIEWPORT_MARGIN = 12;
  const CURSOR_OFFSET = 6;
  const MAX_ITEM_SHORTCUTS = 9;
  const ITEM_SELECTOR = ".tab-switcher-item";
  const BADGE_SELECTOR = ".tab-switcher-shortcut";

  let tabSwitcherSettings = mergeTabSwitcherSettings({});
  let lastMouse = { x: 0, y: 0 };
  let hostEl = null;
  let shadowRoot = null;
  let panelEl = null;
  let searchInput = null;
  let listEl = null;
  let allTabs = [];
  let filteredTabs = [];
  let selectedIndex = 0;
  let isOpen = false;

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  async function refreshSettings() {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    tabSwitcherSettings = mergeTabSwitcherSettings(result[SETTINGS_KEY] ?? {});
  }

  function trackMouse(event) {
    lastMouse = { x: event.clientX, y: event.clientY };
  }

  function getViewportSize() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function canPlaceAtCursor(cursorX, cursorY, panelWidth, panelHeight) {
    const { width: vw, height: vh } = getViewportSize();
    if (panelWidth + VIEWPORT_MARGIN * 2 > vw || panelHeight + VIEWPORT_MARGIN * 2 > vh) {
      return false;
    }

    const fitsRight = cursorX + CURSOR_OFFSET + panelWidth <= vw - VIEWPORT_MARGIN;
    const fitsLeft = cursorX - CURSOR_OFFSET - panelWidth >= VIEWPORT_MARGIN;
    const fitsBelow = cursorY + CURSOR_OFFSET + panelHeight <= vh - VIEWPORT_MARGIN;
    const fitsAbove = cursorY - CURSOR_OFFSET - panelHeight >= VIEWPORT_MARGIN;

    return (fitsRight || fitsLeft) && (fitsBelow || fitsAbove);
  }

  function computePanelPosition(cursorX, cursorY) {
    const { width: vw, height: vh } = getViewportSize();
    const panelWidth = Math.min(PANEL_WIDTH, vw - VIEWPORT_MARGIN * 2);
    const panelHeight = Math.min(PANEL_MAX_HEIGHT, vh - VIEWPORT_MARGIN * 2);

    if (!canPlaceAtCursor(cursorX, cursorY, panelWidth, panelHeight)) {
      return {
        left: Math.max(VIEWPORT_MARGIN, (vw - panelWidth) / 2),
        top: Math.max(VIEWPORT_MARGIN, (vh - panelHeight) / 2),
        width: panelWidth,
        maxHeight: panelHeight,
        anchoredToCursor: false,
      };
    }

    let left = cursorX + CURSOR_OFFSET;
    let top = cursorY + CURSOR_OFFSET;

    if (left + panelWidth > vw - VIEWPORT_MARGIN) {
      left = cursorX - panelWidth - CURSOR_OFFSET;
    }
    if (top + panelHeight > vh - VIEWPORT_MARGIN) {
      top = cursorY - panelHeight - CURSOR_OFFSET;
    }

    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - panelWidth - VIEWPORT_MARGIN));
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - panelHeight - VIEWPORT_MARGIN));

    return {
      left,
      top,
      width: panelWidth,
      maxHeight: panelHeight,
      anchoredToCursor: true,
    };
  }

  function applyPanelPosition(position) {
    if (!panelEl) return;
    panelEl.style.left = `${position.left}px`;
    panelEl.style.top = `${position.top}px`;
    panelEl.style.width = `${position.width}px`;
    panelEl.style.maxHeight = `${position.maxHeight}px`;
  }

  function getModifierLabel() {
    return isMacPlatform() ? "Cmd" : "Ctrl";
  }

  function getVisibleItemIndices(container, itemSelector) {
    const containerRect = container.getBoundingClientRect();
    const indices = [];
    container.querySelectorAll(itemSelector).forEach((item, index) => {
      const rect = item.getBoundingClientRect();
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        indices.push(index);
      }
    });
    return indices;
  }

  function updateShortcutBadges() {
    if (!listEl) return;
    const visibleIndices = getVisibleItemIndices(listEl, ITEM_SELECTOR);
    listEl.querySelectorAll(ITEM_SELECTOR).forEach((item, index) => {
      const badge = item.querySelector(BADGE_SELECTOR);
      if (!badge) return;
      const pos = visibleIndices.indexOf(index);
      if (pos >= 0 && pos < MAX_ITEM_SHORTCUTS) {
        badge.textContent = `${getModifierLabel()} ${pos + 1}`;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    });
  }

  function filterTabs(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      filteredTabs = [...allTabs];
      return;
    }

    filteredTabs = allTabs.filter((tab) => {
      const haystack = [tab.title, tab.url, tab.bookmarkTitle].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }

  function renderList() {
    if (!listEl) return;
    listEl.textContent = "";

    if (filteredTabs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tab-switcher-empty";
      empty.textContent = "没有匹配的标签页";
      listEl.appendChild(empty);
      return;
    }

    filteredTabs.forEach((tab, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tab-switcher-item";
      if (index === selectedIndex) item.classList.add("selected");
      if (tab.active) item.classList.add("active-tab");

      const favicon = document.createElement("img");
      favicon.className = "tab-switcher-favicon";
      favicon.alt = "";
      favicon.src = tab.favIconUrl || "";
      favicon.onerror = () => {
        favicon.style.visibility = "hidden";
      };

      const content = document.createElement("div");
      content.className = "tab-switcher-content";

      const title = document.createElement("div");
      title.className = "tab-switcher-title";
      title.textContent = tab.bookmarkTitle || tab.title || tab.url || "无标题";

      const url = document.createElement("div");
      url.className = "tab-switcher-url";
      url.textContent = tab.url || "";

      const shortcut = document.createElement("span");
      shortcut.className = "tab-switcher-shortcut";
      shortcut.hidden = true;

      content.appendChild(title);
      content.appendChild(url);
      item.appendChild(favicon);
      item.appendChild(content);
      item.appendChild(shortcut);
      item.addEventListener("click", () => {
        activateTab(tab);
      });
      listEl.appendChild(item);
    });

    listEl.querySelector(".tab-switcher-item.selected")?.scrollIntoView({ block: "nearest" });
    updateShortcutBadges();
  }

  function updateSelection(nextIndex) {
    if (filteredTabs.length === 0) {
      selectedIndex = 0;
      renderList();
      return;
    }
    selectedIndex = Math.max(0, Math.min(filteredTabs.length - 1, nextIndex));
    renderList();
  }

  async function activateTab(tab) {
    if (!tab?.id) return;
    closeOverlay();
    try {
      await sendMessage({
        type: "TAB_SWITCHER_ACTIVATE",
        tabId: tab.id,
        windowId: tab.windowId,
      });
    } catch {
      // ignore
    }
  }

  function getStyles() {
    return `
      :host { all: initial; }

      .tab-switcher-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: transparent;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .tab-switcher-panel {
        position: fixed;
        display: flex;
        flex-direction: column;
        min-height: ${PANEL_MIN_HEIGHT}px;
        overflow: hidden;
        border-radius: 12px;
        background: #fff;
        color: #202124;
        border: 1px solid #dadce0;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
      }

      .tab-switcher-search {
        width: 100%;
        border: 0;
        border-bottom: 1px solid #dadce0;
        padding: 12px 14px;
        font-size: 15px;
        outline: none;
        background: #fff;
        color: inherit;
        flex: 0 0 auto;
      }

      .tab-switcher-list {
        overflow: auto;
        padding: 6px;
        flex: 1 1 auto;
        min-height: 0;
      }

      .tab-switcher-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        border: 0;
        border-radius: 8px;
        padding: 9px 10px;
        background: transparent;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }

      .tab-switcher-item.selected { background: #e8f0fe; }

      .tab-switcher-item.active-tab .tab-switcher-title::after {
        content: "当前";
        margin-left: 8px;
        font-size: 11px;
        color: #1a73e8;
      }

      .tab-switcher-favicon {
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        object-fit: contain;
      }

      .tab-switcher-content { min-width: 0; flex: 1; }

      .tab-switcher-title {
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tab-switcher-url {
        margin-top: 2px;
        font-size: 12px;
        color: #5f6368;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tab-switcher-empty {
        padding: 20px 14px;
        text-align: center;
        color: #5f6368;
        font-size: 14px;
      }

      .tab-switcher-shortcut {
        flex: 0 0 auto;
        margin-left: 8px;
        font-size: 11px;
        color: #5f6368;
        background: #f1f3f4;
        border-radius: 4px;
        padding: 2px 6px;
        white-space: nowrap;
      }
    `;
  }

  function ensureOverlay() {
    if (hostEl) return;

    hostEl = document.createElement("div");
    shadowRoot = hostEl.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = getStyles();

    const backdrop = document.createElement("div");
    backdrop.className = "tab-switcher-backdrop";

    panelEl = document.createElement("div");
    panelEl.className = "tab-switcher-panel";

    searchInput = document.createElement("input");
    searchInput.className = "tab-switcher-search";
    searchInput.type = "text";
    searchInput.placeholder = "搜索已打开的标签页…";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;

    listEl = document.createElement("div");
    listEl.className = "tab-switcher-list";
    listEl.addEventListener("scroll", updateShortcutBadges);

    panelEl.appendChild(searchInput);
    panelEl.appendChild(listEl);
    backdrop.appendChild(panelEl);
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(backdrop);

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeOverlay();
    });

    panelEl.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    searchInput.addEventListener("input", () => {
      selectedIndex = 0;
      filterTabs(searchInput.value);
      renderList();
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        updateSelection(selectedIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        updateSelection(selectedIndex - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const tab = filteredTabs[selectedIndex];
        if (tab) activateTab(tab);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      } else {
        const num = parseInt(event.key, 10);
        if (num >= 1 && num <= 9 && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          const visibleIndices = getVisibleItemIndices(listEl, ITEM_SELECTOR);
          const tab = filteredTabs[visibleIndices[num - 1]];
          if (tab) activateTab(tab);
        }
      }
    });
  }

  function closeOverlay() {
    if (!isOpen) return;
    isOpen = false;
    hostEl?.remove();
    hostEl = null;
    shadowRoot = null;
    panelEl = null;
    searchInput = null;
    listEl = null;
    allTabs = [];
    filteredTabs = [];
    selectedIndex = 0;
  }

  async function openOverlay(cursor) {
    if (!tabSwitcherSettings.enabled) return;

    const point = cursor ?? lastMouse;

    if (isOpen) {
      applyPanelPosition(computePanelPosition(point.x, point.y));
      searchInput?.focus();
      searchInput?.select();
      return;
    }

    ensureOverlay();
    applyPanelPosition(computePanelPosition(point.x, point.y));

    try {
      const response = await sendMessage({ type: "TAB_SWITCHER_GET_TABS" });
      allTabs = Array.isArray(response?.tabs) ? response.tabs : [];
    } catch {
      allTabs = [];
    }

    filteredTabs = [...allTabs];
    selectedIndex = Math.max(0, filteredTabs.findIndex((tab) => tab.active));
    renderList();

    document.documentElement.appendChild(hostEl);
    isOpen = true;
    searchInput.value = "";
    searchInput.focus();
  }

  function handleGlobalKeydown(event) {
    if (!tabSwitcherSettings.enabled) return;

    if (isOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOverlay();
      }
      return;
    }

    if (!matchesShortcut(event, tabSwitcherSettings.shortcut)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openOverlay(lastMouse).catch(() => {});
  }

  function init() {
    refreshSettings().catch(() => {});

    document.addEventListener("mousemove", trackMouse, true);
    document.addEventListener("keydown", handleGlobalKeydown, true);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes[SETTINGS_KEY]) return;
      tabSwitcherSettings = mergeTabSwitcherSettings(changes[SETTINGS_KEY].newValue ?? {});
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "OPEN_TAB_SWITCHER") {
        openOverlay(message.cursor ?? lastMouse).catch(() => {});
      }
    });
  }

  init();
})();

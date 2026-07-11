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
  let modifierLabel = getModifierLabel();
  let lastMouse = { x: 0, y: 0 };
  let hostEl = null;
  let shadowRoot = null;
  let panelEl = null;
  let tabsBarEl = null;
  let tabTabsBtn = null;
  let tabHistoryBtn = null;
  let searchInput = null;
  let listEl = null;
  let activeView = "tabs";
  let allTabs = [];
  let allHistory = [];
  let filteredItems = [];
  let historyLoaded = false;
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

  function refreshModifierLabel() {
    modifierLabel = getModifierLabel();
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "";
    const diffMs = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function sortTabsWithActiveFirst(tabs) {
    return [...tabs].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.windowId !== b.windowId) return (a.windowId ?? 0) - (b.windowId ?? 0);
      return (a.index ?? 0) - (b.index ?? 0);
    });
  }

  function updateShortcutBadges() {
    if (!listEl) return;
    const items = listEl.querySelectorAll(ITEM_SELECTOR);
    for (let index = 0; index < items.length; index++) {
      const badge = items[index].querySelector(BADGE_SELECTOR);
      if (!badge) continue;
      if (index < MAX_ITEM_SHORTCUTS) {
        badge.textContent = `${modifierLabel} ${index + 1}`;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  }

  function flushShortcutBadges() {
    updateShortcutBadges();
    requestAnimationFrame(updateShortcutBadges);
  }

  function isSelectedVisible() {
    const items = listEl?.querySelectorAll(ITEM_SELECTOR);
    const item = items?.[selectedIndex];
    if (!item || !listEl) return true;
    const containerRect = listEl.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
  }

  function syncListSelection(allowScroll = true) {
    if (!listEl) return;
    if (allowScroll && !isSelectedVisible()) {
      const selected = listEl.querySelector(`${ITEM_SELECTOR}.selected`);
      selected?.scrollIntoView({ block: "nearest" });
    }
    flushShortcutBadges();
  }

  function getCurrentItems() {
    return activeView === "tabs" ? allTabs : allHistory;
  }

  function filterItems(query) {
    const source = getCurrentItems();
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      filteredItems = [...source];
      return;
    }

    filteredItems = source.filter((item) => {
      const haystack = [item.title, item.url, item.bookmarkTitle].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }

  function updateTabBarHighlight() {
    tabTabsBtn?.classList.toggle("active", activeView === "tabs");
    tabHistoryBtn?.classList.toggle("active", activeView === "history");
  }

  function getEmptyMessage() {
    return activeView === "tabs" ? "没有匹配的标签页" : "没有匹配的历史记录";
  }

  function renderList({ resetScroll = false } = {}) {
    if (!listEl) return;
    refreshModifierLabel();
    listEl.textContent = "";

    if (filteredItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tab-switcher-empty";
      empty.textContent = getEmptyMessage();
      listEl.appendChild(empty);
      return;
    }

    filteredItems.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tab-switcher-item";
      if (index === selectedIndex) row.classList.add("selected");
      if (activeView === "tabs" && item.active) row.classList.add("active-tab");

      const favicon = document.createElement("img");
      favicon.className = "tab-switcher-favicon";
      favicon.alt = "";
      favicon.src = item.favIconUrl || "";
      favicon.onerror = () => {
        favicon.style.visibility = "hidden";
      };

      const content = document.createElement("div");
      content.className = "tab-switcher-content";

      const title = document.createElement("div");
      title.className = "tab-switcher-title";
      title.textContent = item.bookmarkTitle || item.title || item.url || "无标题";

      const subtitle = document.createElement("div");
      subtitle.className = "tab-switcher-url";
      if (activeView === "history") {
        const timeLabel = formatRelativeTime(item.lastVisitTime);
        subtitle.textContent = timeLabel ? `${timeLabel} · ${item.url || ""}` : item.url || "";
      } else {
        subtitle.textContent = item.url || "";
      }

      const shortcut = document.createElement("span");
      shortcut.className = "tab-switcher-shortcut";
      if (index < MAX_ITEM_SHORTCUTS) {
        shortcut.textContent = `${modifierLabel} ${index + 1}`;
        shortcut.hidden = false;
      } else {
        shortcut.hidden = true;
      }

      content.appendChild(title);
      content.appendChild(subtitle);
      row.appendChild(favicon);
      row.appendChild(content);
      row.appendChild(shortcut);
      row.addEventListener("click", () => {
        activateItem(item);
      });
      listEl.appendChild(row);
    });

    if (resetScroll) {
      listEl.scrollTop = 0;
    }
    syncListSelection(!resetScroll);
  }

  function updateSelection(nextIndex) {
    if (filteredItems.length === 0) {
      selectedIndex = 0;
      renderList();
      return;
    }

    const newIndex = Math.max(0, Math.min(filteredItems.length - 1, nextIndex));
    const items = listEl?.querySelectorAll(ITEM_SELECTOR);
    if (items?.length && newIndex !== selectedIndex) {
      items[selectedIndex]?.classList.remove("selected");
      selectedIndex = newIndex;
      items[selectedIndex]?.classList.add("selected");
      syncListSelection();
      return;
    }

    selectedIndex = newIndex;
    renderList();
  }

  async function activateItem(item) {
    if (!item) return;
    closeOverlay();

    try {
      if (activeView === "tabs") {
        if (!item.id) return;
        await sendMessage({
          type: "TAB_SWITCHER_ACTIVATE",
          tabId: item.id,
          windowId: item.windowId,
        });
      } else {
        if (!item.url) return;
        await sendMessage({
          type: "TAB_SWITCHER_OPEN_URL",
          url: item.url,
        });
      }
    } catch {
      // ignore
    }
  }

  async function loadHistoryIfNeeded() {
    if (historyLoaded) return;
    try {
      const response = await sendMessage({ type: "TAB_SWITCHER_GET_HISTORY" });
      allHistory = Array.isArray(response?.items) ? response.items : [];
      historyLoaded = true;
    } catch {
      allHistory = [];
      historyLoaded = true;
    }
  }

  async function switchView(view) {
    if (view === activeView) return;

    activeView = view;
    updateTabBarHighlight();

    if (searchInput) {
      searchInput.value = "";
      searchInput.placeholder =
        activeView === "tabs" ? "搜索已打开的标签页…" : "搜索历史记录…";
    }

    if (activeView === "history") {
      await loadHistoryIfNeeded();
    }

    filterItems("");
    selectedIndex = 0;
    renderList({ resetScroll: true });
    searchInput?.focus();
  }

  function toggleView() {
    switchView(activeView === "tabs" ? "history" : "tabs").catch(() => {});
  }

  function handleSearchKeydown(event) {
    if (event.key === "Tab") {
      event.preventDefault();
      toggleView();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateSelection(selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateSelection(selectedIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filteredItems[selectedIndex];
      if (item) activateItem(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
    } else {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= 9 && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const item = filteredItems[num - 1];
        if (item) activateItem(item);
      }
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

      .tab-switcher-tabs {
        display: flex;
        flex: 0 0 auto;
        border-bottom: 1px solid #dadce0;
        padding: 0 8px;
        gap: 4px;
      }

      .tab-switcher-tab {
        border: 0;
        background: transparent;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 500;
        color: #5f6368;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
      }

      .tab-switcher-tab.active {
        color: #1a73e8;
        border-bottom-color: #1a73e8;
      }

      .tab-switcher-tab:hover:not(.active) {
        color: #202124;
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

    tabsBarEl = document.createElement("div");
    tabsBarEl.className = "tab-switcher-tabs";

    tabTabsBtn = document.createElement("button");
    tabTabsBtn.type = "button";
    tabTabsBtn.className = "tab-switcher-tab active";
    tabTabsBtn.dataset.view = "tabs";
    tabTabsBtn.textContent = "已打开";
    tabTabsBtn.addEventListener("click", () => {
      switchView("tabs").catch(() => {});
    });

    tabHistoryBtn = document.createElement("button");
    tabHistoryBtn.type = "button";
    tabHistoryBtn.className = "tab-switcher-tab";
    tabHistoryBtn.dataset.view = "history";
    tabHistoryBtn.textContent = "历史记录";
    tabHistoryBtn.addEventListener("click", () => {
      switchView("history").catch(() => {});
    });

    tabsBarEl.appendChild(tabTabsBtn);
    tabsBarEl.appendChild(tabHistoryBtn);

    searchInput = document.createElement("input");
    searchInput.className = "tab-switcher-search";
    searchInput.type = "text";
    searchInput.placeholder = "搜索已打开的标签页…";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;

    listEl = document.createElement("div");
    listEl.className = "tab-switcher-list";
    listEl.addEventListener("scroll", updateShortcutBadges);

    panelEl.appendChild(tabsBarEl);
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
      filterItems(searchInput.value);
      renderList({ resetScroll: true });
    });

    searchInput.addEventListener("keydown", handleSearchKeydown);
  }

  function closeOverlay() {
    if (!isOpen) return;
    isOpen = false;
    hostEl?.remove();
    hostEl = null;
    shadowRoot = null;
    panelEl = null;
    tabsBarEl = null;
    tabTabsBtn = null;
    tabHistoryBtn = null;
    searchInput = null;
    listEl = null;
    allTabs = [];
    allHistory = [];
    filteredItems = [];
    activeView = "tabs";
    historyLoaded = false;
    selectedIndex = 0;
  }

  async function openOverlay(cursor, view = "tabs") {
    if (!tabSwitcherSettings.enabled) return;

    const point = cursor ?? lastMouse;

    if (isOpen) {
      applyPanelPosition(computePanelPosition(point.x, point.y));
      if (view !== activeView) {
        await switchView(view);
      }
      searchInput?.focus();
      searchInput?.select();
      return;
    }

    ensureOverlay();
    applyPanelPosition(computePanelPosition(point.x, point.y));

    activeView = view === "history" ? "history" : "tabs";
    historyLoaded = false;
    allHistory = [];

    try {
      const response = await sendMessage({ type: "TAB_SWITCHER_GET_TABS" });
      allTabs = sortTabsWithActiveFirst(Array.isArray(response?.tabs) ? response.tabs : []);
    } catch {
      allTabs = [];
    }

    if (activeView === "history") {
      await loadHistoryIfNeeded();
      filterItems("");
      selectedIndex = 0;
    } else {
      filteredItems = [...allTabs];
      selectedIndex = 0;
    }

    document.documentElement.appendChild(hostEl);
    isOpen = true;
    searchInput.value = "";
    searchInput.placeholder =
      activeView === "tabs" ? "搜索已打开的标签页…" : "搜索历史记录…";
    updateTabBarHighlight();
    renderList({ resetScroll: true });
    searchInput.focus();
  }

  function handleSwitcherShortcut(event) {
    if (matchesShortcut(event, tabSwitcherSettings.shortcut)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isOpen) {
        switchView("tabs").catch(() => {});
      } else {
        openOverlay(lastMouse, "tabs").catch(() => {});
      }
      return true;
    }

    if (matchesShortcut(event, tabSwitcherSettings.historyShortcut)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isOpen) {
        switchView("history").catch(() => {});
      } else {
        openOverlay(lastMouse, "history").catch(() => {});
      }
      return true;
    }

    return false;
  }

  function handleGlobalKeydown(event) {
    if (!tabSwitcherSettings.enabled) return;

    if (isOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOverlay();
        return;
      }
      if (handleSwitcherShortcut(event)) return;
      return;
    }

    handleSwitcherShortcut(event);
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
        openOverlay(message.cursor ?? lastMouse, message.view ?? "tabs").catch(() => {});
      }
    });
  }

  init();
})();

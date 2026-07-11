const searchInput = document.getElementById("searchInput");
const tabListEl = document.getElementById("tabList");
const viewTabButtons = document.querySelectorAll(".view-tab");

const MAX_ITEM_SHORTCUTS = 9;
const ITEM_SELECTOR = ".tab-item";
const BADGE_SELECTOR = ".tab-shortcut";

const initialView = new URLSearchParams(window.location.search).get("view") === "history" ? "history" : "tabs";

let activeView = "tabs";
let allTabs = [];
let allHistory = [];
let filteredItems = [];
let historyLoaded = false;
let selectedIndex = 0;
let modifierLabel = getModifierLabel();

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
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

function getVisibleItemIndices(container, itemSelector) {
  const containerRect = container.getBoundingClientRect();
  const indices = [];
  const items = container.querySelectorAll(itemSelector);
  for (let index = 0; index < items.length; index++) {
    const rect = items[index].getBoundingClientRect();
    if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      indices.push(index);
    }
  }
  return indices;
}

function getEffectiveVisibleIndices(container, itemSelector) {
  const visible = getVisibleItemIndices(container, itemSelector);
  if (visible.length > 0) return visible.slice(0, MAX_ITEM_SHORTCUTS);
  const count = container.querySelectorAll(itemSelector).length;
  if (count === 0) return [];
  return Array.from({ length: Math.min(MAX_ITEM_SHORTCUTS, count) }, (_, i) => i);
}

function updateShortcutBadges() {
  const visibleIndices = getEffectiveVisibleIndices(tabListEl, ITEM_SELECTOR);
  const visibleRank = new Map(visibleIndices.map((index, pos) => [index, pos]));
  const items = tabListEl.querySelectorAll(ITEM_SELECTOR);
  for (let index = 0; index < items.length; index++) {
    const badge = items[index].querySelector(BADGE_SELECTOR);
    if (!badge) continue;
    const pos = visibleRank.get(index);
    if (pos !== undefined) {
      badge.textContent = `${modifierLabel} ${pos + 1}`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
}

function flushShortcutBadges() {
  updateShortcutBadges();
  requestAnimationFrame(() => {
    updateShortcutBadges();
    requestAnimationFrame(updateShortcutBadges);
  });
}

function isSelectedVisible() {
  const items = tabListEl.querySelectorAll(ITEM_SELECTOR);
  const item = items[selectedIndex];
  if (!item) return true;
  const containerRect = tabListEl.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
}

function syncListSelection(allowScroll = true) {
  if (allowScroll && !isSelectedVisible()) {
    const selected = tabListEl.querySelector(`${ITEM_SELECTOR}.selected`);
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
  for (const button of viewTabButtons) {
    button.classList.toggle("active", button.dataset.view === activeView);
  }
}

function getEmptyMessage() {
  return activeView === "tabs" ? "没有匹配的标签页" : "没有匹配的历史记录";
}

function renderList({ resetScroll = false } = {}) {
  refreshModifierLabel();
  tabListEl.textContent = "";

  if (filteredItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = getEmptyMessage();
    tabListEl.appendChild(empty);
    return;
  }

  filteredItems.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tab-item";
    if (index === selectedIndex) row.classList.add("selected");
    if (activeView === "tabs" && item.active) row.classList.add("active-tab");

    const favicon = document.createElement("img");
    favicon.className = "tab-favicon";
    favicon.alt = "";
    favicon.src = item.favIconUrl || "";
    favicon.onerror = () => {
      favicon.style.visibility = "hidden";
    };

    const content = document.createElement("div");
    content.className = "tab-content";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = item.bookmarkTitle || item.title || item.url || "无标题";

    const subtitle = document.createElement("div");
    subtitle.className = "tab-url";
    if (activeView === "history") {
      const timeLabel = formatRelativeTime(item.lastVisitTime);
      subtitle.textContent = timeLabel ? `${timeLabel} · ${item.url || ""}` : item.url || "";
    } else {
      subtitle.textContent = item.url || "";
    }

    const shortcut = document.createElement("span");
    shortcut.className = "tab-shortcut";
    shortcut.hidden = true;

    content.appendChild(title);
    content.appendChild(subtitle);
    row.appendChild(favicon);
    row.appendChild(content);
    row.appendChild(shortcut);

    row.addEventListener("click", () => {
      activateItem(item);
    });

    tabListEl.appendChild(row);
  });

  if (resetScroll) {
    tabListEl.scrollTop = 0;
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
  const items = tabListEl.querySelectorAll(ITEM_SELECTOR);
  if (items.length && newIndex !== selectedIndex) {
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
  } finally {
    window.close();
  }
}

async function loadTabs() {
  const response = await sendMessage({ type: "TAB_SWITCHER_GET_TABS" });
  allTabs = sortTabsWithActiveFirst(Array.isArray(response?.tabs) ? response.tabs : []);
}

async function loadHistoryIfNeeded() {
  if (historyLoaded) return;
  const response = await sendMessage({ type: "TAB_SWITCHER_GET_HISTORY" });
  allHistory = Array.isArray(response?.items) ? response.items : [];
  historyLoaded = true;
}

async function switchView(view) {
  if (view === activeView) return;

  activeView = view;
  updateTabBarHighlight();

  searchInput.value = "";
  searchInput.placeholder = activeView === "tabs" ? "搜索已打开的标签页…" : "搜索历史记录…";

  if (activeView === "history") {
    await loadHistoryIfNeeded();
  }

  filterItems("");
  selectedIndex = 0;
  renderList({ resetScroll: true });
  searchInput.focus();
}

function toggleView() {
  switchView(activeView === "tabs" ? "history" : "tabs").catch(() => {});
}

searchInput.addEventListener("input", () => {
  selectedIndex = 0;
  filterItems(searchInput.value);
  renderList({ resetScroll: true });
});

searchInput.addEventListener("keydown", (event) => {
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
    window.close();
  } else {
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= 9 && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      const visibleIndices = getEffectiveVisibleIndices(tabListEl, ITEM_SELECTOR);
      const item = filteredItems[visibleIndices[num - 1]];
      if (item) activateItem(item);
    }
  }
});

for (const button of viewTabButtons) {
  button.addEventListener("click", () => {
    switchView(button.dataset.view).catch(() => {});
  });
}

tabListEl.addEventListener("scroll", updateShortcutBadges);

async function init() {
  try {
    await loadTabs();
    activeView = "tabs";
    filterItems("");
    selectedIndex = 0;
    updateTabBarHighlight();
    renderList({ resetScroll: true });
    flushShortcutBadges();

    if (initialView === "history") {
      await switchView("history");
    } else {
      searchInput.focus();
    }
  } catch {
    tabListEl.textContent = "";
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = "无法加载列表";
    tabListEl.appendChild(empty);
  }
}

init();

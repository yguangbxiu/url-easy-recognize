const searchInput = document.getElementById("searchInput");
const tabListEl = document.getElementById("tabList");

const MAX_ITEM_SHORTCUTS = 9;
const ITEM_SELECTOR = ".tab-item";
const BADGE_SELECTOR = ".tab-shortcut";

let allTabs = [];
let filteredTabs = [];
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

function getVisibleItemIndices(container, itemSelector) {
  const scrollTop = container.scrollTop;
  const viewportBottom = scrollTop + container.clientHeight;
  const indices = [];
  const items = container.querySelectorAll(itemSelector);
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (bottom > scrollTop && top < viewportBottom) {
      indices.push(index);
    }
  }
  return indices;
}

function updateShortcutBadges() {
  const visibleIndices = getVisibleItemIndices(tabListEl, ITEM_SELECTOR);
  const visibleRank = new Map(visibleIndices.map((index, pos) => [index, pos]));
  const items = tabListEl.querySelectorAll(ITEM_SELECTOR);
  for (let index = 0; index < items.length; index++) {
    const badge = items[index].querySelector(BADGE_SELECTOR);
    if (!badge) continue;
    const pos = visibleRank.get(index);
    if (pos !== undefined && pos < MAX_ITEM_SHORTCUTS) {
      badge.textContent = `${modifierLabel} ${pos + 1}`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
}

function syncListSelection() {
  const selected = tabListEl.querySelector(`${ITEM_SELECTOR}.selected`);
  selected?.scrollIntoView({ block: "nearest" });
  updateShortcutBadges();
  requestAnimationFrame(updateShortcutBadges);
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
  refreshModifierLabel();
  tabListEl.textContent = "";

  if (filteredTabs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = "没有匹配的标签页";
    tabListEl.appendChild(empty);
    return;
  }

  filteredTabs.forEach((tab, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tab-item";
    if (index === selectedIndex) item.classList.add("selected");
    if (tab.active) item.classList.add("active-tab");

    const favicon = document.createElement("img");
    favicon.className = "tab-favicon";
    favicon.alt = "";
    favicon.src = tab.favIconUrl || "";
    favicon.onerror = () => {
      favicon.style.visibility = "hidden";
    };

    const content = document.createElement("div");
    content.className = "tab-content";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.bookmarkTitle || tab.title || tab.url || "无标题";

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = tab.url || "";

    const shortcut = document.createElement("span");
    shortcut.className = "tab-shortcut";
    if (index < MAX_ITEM_SHORTCUTS) {
      shortcut.textContent = `${modifierLabel} ${index + 1}`;
    } else {
      shortcut.hidden = true;
    }

    content.appendChild(title);
    content.appendChild(url);
    item.appendChild(favicon);
    item.appendChild(content);
    item.appendChild(shortcut);

    item.addEventListener("click", () => {
      activateTab(tab);
    });

    tabListEl.appendChild(item);
  });

  syncListSelection();
}

function updateSelection(nextIndex) {
  if (filteredTabs.length === 0) {
    selectedIndex = 0;
    renderList();
    return;
  }

  const newIndex = Math.max(0, Math.min(filteredTabs.length - 1, nextIndex));
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

async function activateTab(tab) {
  if (!tab?.id) return;

  try {
    await sendMessage({
      type: "TAB_SWITCHER_ACTIVATE",
      tabId: tab.id,
      windowId: tab.windowId,
    });
  } finally {
    window.close();
  }
}

async function loadTabs() {
  const response = await sendMessage({ type: "TAB_SWITCHER_GET_TABS" });
  allTabs = Array.isArray(response?.tabs) ? response.tabs : [];
  filteredTabs = [...allTabs];
  selectedIndex = Math.max(0, filteredTabs.findIndex((tab) => tab.active));
  renderList();
}

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
    window.close();
  } else {
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= 9 && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      const visibleIndices = getVisibleItemIndices(tabListEl, ITEM_SELECTOR);
      const tab = filteredTabs[visibleIndices[num - 1]];
      if (tab) activateTab(tab);
    }
  }
});

tabListEl.addEventListener("scroll", updateShortcutBadges);

loadTabs().catch(() => {
  tabListEl.textContent = "";
  const empty = document.createElement("div");
  empty.className = "tab-empty";
  empty.textContent = "无法加载标签页列表";
  tabListEl.appendChild(empty);
});

searchInput.focus();

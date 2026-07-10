const searchInput = document.getElementById("searchInput");
const tabListEl = document.getElementById("tabList");

const MAX_ITEM_SHORTCUTS = 9;
const ITEM_SELECTOR = ".tab-item";
const BADGE_SELECTOR = ".tab-shortcut";

let allTabs = [];
let filteredTabs = [];
let selectedIndex = 0;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
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
  const visibleIndices = getVisibleItemIndices(tabListEl, ITEM_SELECTOR);
  tabListEl.querySelectorAll(ITEM_SELECTOR).forEach((item, index) => {
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
    shortcut.hidden = true;

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

  tabListEl.querySelector(".tab-item.selected")?.scrollIntoView({ block: "nearest" });
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

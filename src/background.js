importScripts("bookmark-index.js", "settings.js");

const SKIPPED_URL_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "about:"];

const SETTINGS_POPUP_PATH = "popup/settings.html";
const CLICK_DELAY_MS = 300;
const TAB_SWITCHER_COMMAND = "open-tab-switcher";
const HISTORY_SWITCHER_COMMAND = "open-history-switcher";
const TAB_SWITCHER_POPUP = "popup/tab-switcher.html";
const TAB_SWITCHER_FILES = ["src/shortcut.js", "src/tab-switcher.js"];

let tabSwitcherWindowId = null;

let clickTimer = null;

function isApplicableUrl(url) {
  if (!url) return false;
  return !SKIPPED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTitleMessage(tabId, message) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      if (attempt < 4) {
        await delay(50 * (attempt + 1));
      }
    }
  }
  return false;
}

async function applyTitleToTab(tabId, url) {
  if (!isApplicableUrl(url)) return;

  const settings = getSettings();
  if (!settings.enabled) {
    await sendTitleMessage(tabId, { type: "CLEAR_BOOKMARK_TITLE" });
    return;
  }

  const title = lookupBookmarkTitle(url);
  if (title) {
    const displayTitle = truncateTitle(title, settings);
    await sendTitleMessage(tabId, { type: "SET_BOOKMARK_TITLE", title: displayTitle });
  } else {
    await sendTitleMessage(tabId, { type: "CLEAR_BOOKMARK_TITLE" });
  }
}

function scheduleApplyTitleToTab(tabId, url) {
  applyTitleToTab(tabId, url).catch(() => {});
}

async function reapplyAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null && tab.url) {
      await applyTitleToTab(tab.id, tab.url);
    }
  }
}

async function openSettingsPopup() {
  await chrome.action.setPopup({ popup: SETTINGS_POPUP_PATH });
  try {
    await chrome.action.openPopup();
  } finally {
    await chrome.action.setPopup({ popup: "" });
  }
}

async function handleToggleEnabled() {
  const settings = await toggleEnabled();
  updateActionTitle(settings);
  await reapplyAllTabs();
}

async function syncHistorySwitcherCommand(settings) {
  if (!settings.tabSwitcher?.enabled) {
    return { ok: false, error: "功能已禁用" };
  }

  const chromeShortcut = shortcutToChromeCommand(settings.tabSwitcher.historyShortcut);
  if (!chromeShortcut) {
    return { ok: false, error: "历史快捷键无效" };
  }

  try {
    await chrome.commands.update({
      name: HISTORY_SWITCHER_COMMAND,
      shortcut: chromeShortcut,
    });
    return { ok: true, chromeShortcut };
  } catch (error) {
    return {
      ok: false,
      error: error?.message ?? String(error),
      chromeShortcut,
    };
  }
}

async function syncAllSwitcherCommands(settings) {
  const tabsResult = await syncTabSwitcherCommand(settings);
  const historyResult = await syncHistorySwitcherCommand(settings);
  return { tabs: tabsResult, history: historyResult };
}

async function syncTabSwitcherCommand(settings) {
  if (!settings.tabSwitcher?.enabled) {
    return { ok: false, error: "功能已禁用" };
  }

  const chromeShortcut = shortcutToChromeCommand(settings.tabSwitcher.shortcut);
  if (!chromeShortcut) {
    return { ok: false, error: "快捷键无效" };
  }

  try {
    await chrome.commands.update({
      name: TAB_SWITCHER_COMMAND,
      shortcut: chromeShortcut,
    });
    return { ok: true, chromeShortcut };
  } catch (error) {
    return {
      ok: false,
      error: error?.message ?? String(error),
      chromeShortcut,
    };
  }
}

async function openTabSwitcherOnActiveTab(view = "tabs") {
  const settings = getSettings();
  if (!settings.tabSwitcher?.enabled) return false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isApplicableUrl(tab.url)) return false;

  const open = () => chrome.tabs.sendMessage(tab.id, { type: "OPEN_TAB_SWITCHER", view });

  try {
    await open();
    return true;
  } catch {
    // 扩展重载后旧页面尚未注入脚本
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: TAB_SWITCHER_FILES,
    });
    await delay(100);
    await open();
    return true;
  } catch {
    return false;
  }
}

async function openTabSwitcherPopup(view = "tabs") {
  const settings = getSettings();
  if (!settings.tabSwitcher?.enabled) return;

  const popupUrl =
    view === "history"
      ? `${chrome.runtime.getURL(TAB_SWITCHER_POPUP)}?view=history`
      : chrome.runtime.getURL(TAB_SWITCHER_POPUP);

  if (tabSwitcherWindowId != null) {
    try {
      const win = await chrome.windows.get(tabSwitcherWindowId);
      await chrome.windows.update(tabSwitcherWindowId, { focused: true });
      const [popupTab] = await chrome.tabs.query({ windowId: win.id });
      if (popupTab?.id && view === "history") {
        await chrome.tabs.update(popupTab.id, { url: popupUrl });
      }
      return;
    } catch {
      tabSwitcherWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: popupUrl,
    type: "popup",
    width: 660,
    height: 520,
    focused: true,
  });
  tabSwitcherWindowId = win.id;
}

async function openTabSwitcher(view = "tabs") {
  const openedOnPage = await openTabSwitcherOnActiveTab(view);
  if (!openedOnPage) {
    await openTabSwitcherPopup(view);
  }
}

async function bootstrap() {
  await loadSettings();
  updateActionTitle(getSettings());
  await syncAllSwitcherCommands(getSettings());
  await refreshBookmarkIndex();
  await reapplyAllTabs();
}

bootstrap().catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[SETTINGS_KEY]) return;
  cachedSettings = mergeSettings(changes[SETTINGS_KEY].newValue ?? {});
  updateActionTitle(cachedSettings);
  syncAllSwitcherCommands(cachedSettings).catch(() => {});
  reapplyAllTabs().catch(() => {});
});

async function getTabSwitcherTabs() {
  const tabs = await chrome.tabs.query({});
  const settings = getSettings();

  return tabs
    .filter((tab) => tab.id != null)
    .map((tab) => {
      let bookmarkTitle = null;
      if (settings.enabled && tab.url) {
        const title = lookupBookmarkTitle(tab.url);
        if (title) {
          bookmarkTitle = truncateTitle(title, settings);
        }
      }

      return {
        id: tab.id,
        title: tab.title ?? "",
        url: tab.url ?? "",
        favIconUrl: tab.favIconUrl ?? "",
        windowId: tab.windowId,
        active: tab.active,
        index: tab.index,
        bookmarkTitle,
      };
    });
}

async function getFaviconUrl(url) {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
  } catch {
    return "";
  }
}

const HISTORY_MAX_RESULTS = 100;

async function getTabSwitcherHistory() {
  const items = await chrome.history.search({ text: "", maxResults: 200, startTime: 0 });
  const settings = getSettings();
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);

    let bookmarkTitle = null;
    if (settings.enabled) {
      const title = lookupBookmarkTitle(item.url);
      if (title) {
        bookmarkTitle = truncateTitle(title, settings);
      }
    }

    result.push({
      url: item.url,
      title: item.title ?? "",
      lastVisitTime: item.lastVisitTime ?? 0,
      visitCount: item.visitCount ?? 0,
      bookmarkTitle,
      favIconUrl: getFaviconUrl(item.url),
    });

    if (result.length >= HISTORY_MAX_RESULTS) break;
  }

  return result;
}

async function openHistoryUrl(url) {
  if (!url) return;

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url === url);
  if (existing?.id != null) {
    await activateTab(existing.id, existing.windowId);
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

async function activateTab(tabId, windowId) {
  if (windowId != null) {
    await chrome.windows.update(windowId, { focused: true });
  }
  await chrome.tabs.update(tabId, { active: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TAB_SWITCHER_GET_TABS") {
    getTabSwitcherTabs()
      .then((tabs) => sendResponse({ tabs }))
      .catch(() => sendResponse({ tabs: [] }));
    return true;
  }

  if (message.type === "TAB_SWITCHER_ACTIVATE") {
    activateTab(message.tabId, message.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "TAB_SWITCHER_GET_HISTORY") {
    getTabSwitcherHistory()
      .then((items) => sendResponse({ items }))
      .catch(() => sendResponse({ items: [] }));
    return true;
  }

  if (message.type === "TAB_SWITCHER_OPEN_URL") {
    openHistoryUrl(message.url)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "OPEN_TAB_SWITCHER") {
    openTabSwitcher(message.view ?? "tabs")
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "SYNC_TAB_SWITCHER_COMMAND") {
    syncAllSwitcherCommands(getSettings())
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? String(error) }));
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === TAB_SWITCHER_COMMAND) {
    openTabSwitcher("tabs").catch(() => {});
  }
  if (command === HISTORY_SWITCHER_COMMAND) {
    openTabSwitcher("history").catch(() => {});
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === tabSwitcherWindowId) {
    tabSwitcherWindowId = null;
  }
});

chrome.action.onClicked.addListener(() => {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    handleToggleEnabled().catch(() => {});
    return;
  }

  openSettingsPopup().catch(() => {});

  clickTimer = setTimeout(() => {
    clickTimer = null;
  }, CLICK_DELAY_MS);
});

chrome.runtime.onInstalled.addListener(() => {
  loadSettings()
    .then((settings) => {
      updateActionTitle(settings);
      return refreshBookmarkIndex();
    })
    .then(() => reapplyAllTabs())
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  loadSettings()
    .then((settings) => {
      updateActionTitle(settings);
      return refreshBookmarkIndex();
    })
    .then(() => reapplyAllTabs())
    .catch(() => {});
});

chrome.bookmarks.onCreated.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
});

chrome.bookmarks.onChanged.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
});

chrome.bookmarks.onRemoved.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
});

chrome.bookmarks.onMoved.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
});

chrome.bookmarks.onImportEnded.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    scheduleApplyTitleToTab(tabId, changeInfo.url);
    return;
  }
  if (changeInfo.status === "complete" && tab.url) {
    scheduleApplyTitleToTab(tabId, tab.url);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) {
    scheduleApplyTitleToTab(details.tabId, details.url);
  }
});

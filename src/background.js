importScripts("bookmark-index.js", "settings.js");

const SKIPPED_URL_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "about:"];

const SETTINGS_POPUP_PATH = "popup/settings.html";
const CLICK_DELAY_MS = 300;
const TAB_SWITCHER_COMMAND = "open-tab-switcher";
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

async function openTabSwitcherOnActiveTab() {
  const settings = getSettings();
  if (!settings.tabSwitcher?.enabled) return false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isApplicableUrl(tab.url)) return false;

  const open = () => chrome.tabs.sendMessage(tab.id, { type: "OPEN_TAB_SWITCHER" });

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

async function openTabSwitcherPopup() {
  const settings = getSettings();
  if (!settings.tabSwitcher?.enabled) return;

  if (tabSwitcherWindowId != null) {
    try {
      await chrome.windows.get(tabSwitcherWindowId);
      await chrome.windows.update(tabSwitcherWindowId, { focused: true });
      return;
    } catch {
      tabSwitcherWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(TAB_SWITCHER_POPUP),
    type: "popup",
    width: 660,
    height: 520,
    focused: true,
  });
  tabSwitcherWindowId = win.id;
}

async function openTabSwitcher() {
  const openedOnPage = await openTabSwitcherOnActiveTab();
  if (!openedOnPage) {
    await openTabSwitcherPopup();
  }
}

async function bootstrap() {
  await loadSettings();
  updateActionTitle(getSettings());
  await syncTabSwitcherCommand(getSettings());
  await refreshBookmarkIndex();
  await reapplyAllTabs();
}

bootstrap().catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[SETTINGS_KEY]) return;
  cachedSettings = mergeSettings(changes[SETTINGS_KEY].newValue ?? {});
  updateActionTitle(cachedSettings);
  syncTabSwitcherCommand(cachedSettings).catch(() => {});
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

  if (message.type === "OPEN_TAB_SWITCHER") {
    openTabSwitcher()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "SYNC_TAB_SWITCHER_COMMAND") {
    syncTabSwitcherCommand(getSettings())
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? String(error) }));
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === TAB_SWITCHER_COMMAND) {
    openTabSwitcher().catch(() => {});
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

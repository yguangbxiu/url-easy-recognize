importScripts("bookmark-index.js", "settings.js");

const SKIPPED_URL_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "about:"];

const SETTINGS_POPUP_PATH = "popup/settings.html";
const CLICK_DELAY_MS = 300;

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

async function bootstrap() {
  await loadSettings();
  updateActionTitle(getSettings());
  await refreshBookmarkIndex();
  await reapplyAllTabs();
}

bootstrap().catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[SETTINGS_KEY]) return;
  cachedSettings = { ...DEFAULTS, ...changes[SETTINGS_KEY].newValue };
  updateActionTitle(cachedSettings);
  reapplyAllTabs().catch(() => {});
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

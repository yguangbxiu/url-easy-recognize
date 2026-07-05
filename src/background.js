importScripts("bookmark-index.js");

const SKIPPED_URL_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "about:"];

function isApplicableUrl(url) {
  if (!url) return false;
  return !SKIPPED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function sendTitleMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content.js"],
      });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

async function applyTitleToTab(tabId, url) {
  if (!isApplicableUrl(url)) return;

  const title = lookupBookmarkTitle(url);
  if (title) {
    await sendTitleMessage(tabId, { type: "SET_BOOKMARK_TITLE", title });
  } else {
    await sendTitleMessage(tabId, { type: "CLEAR_BOOKMARK_TITLE" });
  }
}

function scheduleApplyTitleToTab(tabId, url) {
  applyTitleToTab(tabId, url).catch(() => {});
}

refreshBookmarkIndex().catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshBookmarkIndex().catch(() => {});
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

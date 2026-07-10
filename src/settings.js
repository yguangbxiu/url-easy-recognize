importScripts("shortcut.js");

const SETTINGS_KEY = "settings";

const DEFAULTS = {
  enabled: true,
  lengthMode: "all",
  customLength: 10,
  tabSwitcher: { ...DEFAULT_TAB_SWITCHER, shortcut: { ...DEFAULT_TAB_SWITCHER.shortcut } },
};

let cachedSettings = structuredClone(DEFAULTS);

function mergeSettings(stored) {
  return {
    ...DEFAULTS,
    ...stored,
    tabSwitcher: mergeTabSwitcherSettings(stored),
  };
}

function truncateTitle(title, settings) {
  if (!title) return title;

  const mode = settings.lengthMode ?? DEFAULTS.lengthMode;
  if (mode === "all") return title;
  if (mode === "first3") return title.slice(0, 3);
  if (mode === "first5") return title.slice(0, 5);
  if (mode === "custom") {
    const len = Math.max(1, Math.min(100, settings.customLength ?? DEFAULTS.customLength));
    return title.slice(0, len);
  }
  return title;
}

async function loadSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  cachedSettings = mergeSettings(result[SETTINGS_KEY] ?? {});
  return cachedSettings;
}

function getSettings() {
  return cachedSettings;
}

async function saveSettings(partial) {
  const next = { ...cachedSettings, ...partial };
  if (partial.tabSwitcher) {
    next.tabSwitcher = mergeTabSwitcherSettings({
      tabSwitcher: { ...cachedSettings.tabSwitcher, ...partial.tabSwitcher },
    });
  }
  cachedSettings = next;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: cachedSettings });
  return cachedSettings;
}

async function toggleEnabled() {
  return saveSettings({ enabled: !cachedSettings.enabled });
}

function updateActionTitle(settings) {
  const state = settings.enabled ? "已开启" : "已关闭";
  chrome.action.setTitle({ title: `URL Easy Recognize（${state}）` });
  chrome.action.setBadgeText({ text: settings.enabled ? "" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#888888" });
}

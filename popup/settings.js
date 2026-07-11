const SETTINGS_KEY = "settings";

const DEFAULTS = {
  enabled: true,
  lengthMode: "all",
  customLength: 10,
  tabSwitcher: {
    ...DEFAULT_TAB_SWITCHER,
    shortcut: { ...DEFAULT_TAB_SWITCHER.shortcut },
    historyShortcut: { ...DEFAULT_TAB_SWITCHER.historyShortcut },
  },
};

const enabledRadios = document.querySelectorAll('input[name="enabled"]');
const lengthRadios = document.querySelectorAll('input[name="lengthMode"]');
const lengthSection = document.getElementById("length-section");
const customLengthInput = document.getElementById("customLength");
const tabSwitcherRadios = document.querySelectorAll('input[name="tabSwitcherEnabled"]');
const tabSwitcherSection = document.getElementById("tab-switcher-section");
const shortcutDisplay = document.getElementById("shortcutDisplay");
const historyShortcutDisplay = document.getElementById("historyShortcutDisplay");
const recordShortcutButton = document.getElementById("recordShortcut");
const resetShortcutButton = document.getElementById("resetShortcut");
const testTabSwitcherButton = document.getElementById("testTabSwitcher");
const recordHistoryShortcutButton = document.getElementById("recordHistoryShortcut");
const resetHistoryShortcutButton = document.getElementById("resetHistoryShortcut");
const testHistorySwitcherButton = document.getElementById("testHistorySwitcher");
const shortcutHint = document.getElementById("shortcutHint");

let currentSettings = structuredClone(DEFAULTS);
let saving = false;
let recordingTarget = null;

function mergeSettings(stored) {
  return {
    ...DEFAULTS,
    ...stored,
    tabSwitcher: mergeTabSwitcherSettings(stored),
  };
}

async function readSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY] ?? {});
}

async function writeSettings(partial) {
  const next = { ...currentSettings, ...partial };
  if (partial.tabSwitcher) {
    next.tabSwitcher = mergeTabSwitcherSettings({
      tabSwitcher: { ...currentSettings.tabSwitcher, ...partial.tabSwitcher },
    });
  }
  currentSettings = next;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: currentSettings });
}

async function syncShortcutToSystem() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_TAB_SWITCHER_COMMAND" });
    const tabsShortcut = formatShortcut(currentSettings.tabSwitcher.shortcut);
    const historyShortcut = formatShortcut(currentSettings.tabSwitcher.historyShortcut);

    if (result?.tabs?.ok && result?.history?.ok) {
      shortcutHint.textContent = `快捷键已生效：${tabsShortcut} / ${historyShortcut}`;
      return;
    }

    const parts = [];
    if (result?.tabs?.ok) {
      parts.push(`${tabsShortcut}（系统：${result.tabs.chromeShortcut}）`);
    } else {
      parts.push(tabsShortcut);
    }
    if (result?.history?.ok) {
      parts.push(`${historyShortcut}（系统：${result.history.chromeShortcut}）`);
    } else {
      parts.push(historyShortcut);
    }
    shortcutHint.textContent = `快捷键已保存：${parts.join(" / ")}。若系统注册失败，请到 chrome://extensions/shortcuts 手动分配`;
  } catch {
    shortcutHint.textContent = "快捷键已保存，请刷新网页后使用";
  }
}

function updateLengthSectionState() {
  const enabled = currentSettings.enabled;
  lengthSection.classList.toggle("disabled", !enabled);
  customLengthInput.disabled = !enabled || currentSettings.lengthMode !== "custom";
}

function updateTabSwitcherSectionState() {
  const enabled = currentSettings.tabSwitcher.enabled;
  const recording = recordingTarget != null;
  tabSwitcherSection.classList.toggle("disabled", !enabled);
  recordShortcutButton.disabled = !enabled || recording;
  resetShortcutButton.disabled = !enabled || recording;
  testTabSwitcherButton.disabled = !enabled || recording;
  recordHistoryShortcutButton.disabled = !enabled || recording;
  resetHistoryShortcutButton.disabled = !enabled || recording;
  testHistorySwitcherButton.disabled = !enabled || recording;
}

function syncShortcutDisplay() {
  shortcutDisplay.textContent = formatShortcut(currentSettings.tabSwitcher.shortcut);
  historyShortcutDisplay.textContent = formatShortcut(currentSettings.tabSwitcher.historyShortcut);
}

function syncFormFromSettings() {
  for (const radio of enabledRadios) {
    radio.checked = radio.value === String(currentSettings.enabled);
  }
  for (const radio of lengthRadios) {
    radio.checked = radio.value === currentSettings.lengthMode;
  }
  customLengthInput.value = currentSettings.customLength;
  for (const radio of tabSwitcherRadios) {
    radio.checked = radio.value === String(currentSettings.tabSwitcher.enabled);
  }
  syncShortcutDisplay();
  updateLengthSectionState();
  updateTabSwitcherSectionState();
}

function startShortcutRecording(target) {
  if (recordingTarget || !currentSettings.tabSwitcher.enabled) return;

  const isHistory = target === "history";
  const recordButton = isHistory ? recordHistoryShortcutButton : recordShortcutButton;
  const defaultHint = "默认 Cmd+Shift+G / Cmd+Shift+H。若无效，请到 chrome://extensions/shortcuts 手动分配";

  recordingTarget = target;
  recordButton.textContent = "请按下快捷键…";
  updateTabSwitcherSectionState();
  shortcutHint.textContent = "按下目标组合键，需包含 Ctrl / Cmd / Alt / Shift 之一";

  const finish = () => {
    recordingTarget = null;
    recordButton.textContent = "录制";
    updateTabSwitcherSectionState();
    shortcutHint.textContent = defaultHint;
    window.removeEventListener("keydown", handleRecordKeydown, true);
  };

  const handleRecordKeydown = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      finish();
      return;
    }

    const shortcut = captureShortcutFromEvent(event);
    if (!shortcut) {
      shortcutHint.textContent = "请同时按住修饰键（如 Cmd）再按主键";
      return;
    }

    saving = true;
    try {
      const partial = isHistory ? { historyShortcut: shortcut } : { shortcut };
      await writeSettings({ tabSwitcher: partial });
      syncShortcutDisplay();
      await syncShortcutToSystem();
    } finally {
      saving = false;
      finish();
    }
  };

  window.addEventListener("keydown", handleRecordKeydown, true);
}

async function init() {
  currentSettings = await readSettings();
  syncFormFromSettings();
  await syncShortcutToSystem();

  for (const radio of enabledRadios) {
    radio.addEventListener("change", async () => {
      if (saving) return;
      saving = true;
      try {
        await writeSettings({ enabled: radio.value === "true" });
        updateLengthSectionState();
      } finally {
        saving = false;
      }
    });
  }

  for (const radio of lengthRadios) {
    radio.addEventListener("change", async () => {
      if (saving || !radio.checked) return;
      saving = true;
      try {
        await writeSettings({ lengthMode: radio.value });
        updateLengthSectionState();
      } finally {
        saving = false;
      }
    });
  }

  customLengthInput.addEventListener("change", async () => {
    if (saving) return;
    const value = Math.max(1, Math.min(100, Number(customLengthInput.value) || DEFAULTS.customLength));
    customLengthInput.value = value;
    saving = true;
    try {
      await writeSettings({ customLength: value, lengthMode: "custom" });
      for (const radio of lengthRadios) {
        radio.checked = radio.value === "custom";
      }
      updateLengthSectionState();
    } finally {
      saving = false;
    }
  });

  for (const radio of tabSwitcherRadios) {
    radio.addEventListener("change", async () => {
      if (saving) return;
      saving = true;
      try {
        await writeSettings({ tabSwitcher: { enabled: radio.value === "true" } });
        updateTabSwitcherSectionState();
      } finally {
        saving = false;
      }
    });
  }

  recordShortcutButton.addEventListener("click", () => startShortcutRecording("tabs"));
  recordHistoryShortcutButton.addEventListener("click", () => startShortcutRecording("history"));

  resetShortcutButton.addEventListener("click", async () => {
    if (saving || recordingTarget) return;
    saving = true;
    try {
      await writeSettings({
        tabSwitcher: {
          shortcut: { ...DEFAULT_TAB_SWITCHER.shortcut },
        },
      });
      syncShortcutDisplay();
      await syncShortcutToSystem();
    } finally {
      saving = false;
    }
  });

  resetHistoryShortcutButton.addEventListener("click", async () => {
    if (saving || recordingTarget) return;
    saving = true;
    try {
      await writeSettings({
        tabSwitcher: {
          historyShortcut: { ...DEFAULT_TAB_SWITCHER.historyShortcut },
        },
      });
      syncShortcutDisplay();
      await syncShortcutToSystem();
    } finally {
      saving = false;
    }
  });

  testTabSwitcherButton.addEventListener("click", async () => {
    if (recordingTarget) return;
    try {
      await chrome.runtime.sendMessage({ type: "OPEN_TAB_SWITCHER", view: "tabs" });
    } catch {
      shortcutHint.textContent = "打开失败，请重新加载扩展后重试";
    }
  });

  testHistorySwitcherButton.addEventListener("click", async () => {
    if (recordingTarget) return;
    try {
      await chrome.runtime.sendMessage({ type: "OPEN_TAB_SWITCHER", view: "history" });
    } catch {
      shortcutHint.textContent = "打开失败，请重新加载扩展后重试";
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return;
    currentSettings = mergeSettings(changes[SETTINGS_KEY].newValue ?? {});
    syncFormFromSettings();
  });
}

init();

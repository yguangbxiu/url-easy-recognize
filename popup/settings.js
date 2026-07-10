const SETTINGS_KEY = "settings";

const DEFAULTS = {
  enabled: true,
  lengthMode: "all",
  customLength: 10,
  tabSwitcher: { ...DEFAULT_TAB_SWITCHER, shortcut: { ...DEFAULT_TAB_SWITCHER.shortcut } },
};

const enabledRadios = document.querySelectorAll('input[name="enabled"]');
const lengthRadios = document.querySelectorAll('input[name="lengthMode"]');
const lengthSection = document.getElementById("length-section");
const customLengthInput = document.getElementById("customLength");
const tabSwitcherRadios = document.querySelectorAll('input[name="tabSwitcherEnabled"]');
const tabSwitcherSection = document.getElementById("tab-switcher-section");
const shortcutDisplay = document.getElementById("shortcutDisplay");
const recordShortcutButton = document.getElementById("recordShortcut");
const resetShortcutButton = document.getElementById("resetShortcut");
const testTabSwitcherButton = document.getElementById("testTabSwitcher");
const shortcutHint = document.getElementById("shortcutHint");

let currentSettings = structuredClone(DEFAULTS);
let saving = false;
let recordingShortcut = false;

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
    if (result?.ok) {
      shortcutHint.textContent = `快捷键已生效：${formatShortcut(currentSettings.tabSwitcher.shortcut)}（系统：${result.chromeShortcut}）`;
      return;
    }
    shortcutHint.textContent = `快捷键已保存为 ${formatShortcut(currentSettings.tabSwitcher.shortcut)}，在网页中可直接使用；系统快捷键注册失败，请到 chrome://extensions/shortcuts 手动分配`;
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
  tabSwitcherSection.classList.toggle("disabled", !enabled);
  recordShortcutButton.disabled = !enabled || recordingShortcut;
  resetShortcutButton.disabled = !enabled || recordingShortcut;
  testTabSwitcherButton.disabled = !enabled || recordingShortcut;
}

function syncShortcutDisplay() {
  shortcutDisplay.textContent = formatShortcut(currentSettings.tabSwitcher.shortcut);
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

function startShortcutRecording() {
  if (recordingShortcut || !currentSettings.tabSwitcher.enabled) return;

  recordingShortcut = true;
  recordShortcutButton.textContent = "请按下快捷键…";
  recordShortcutButton.disabled = true;
  resetShortcutButton.disabled = true;
  shortcutHint.textContent = "按下目标组合键，需包含 Ctrl / Cmd / Alt / Shift 之一";

  const finish = () => {
    recordingShortcut = false;
    recordShortcutButton.textContent = "录制快捷键";
    updateTabSwitcherSectionState();
    shortcutHint.textContent = "默认 Cmd+Shift+G。若无效，请到 chrome://extensions/shortcuts 手动分配";
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
      await writeSettings({ tabSwitcher: { shortcut } });
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

  recordShortcutButton.addEventListener("click", startShortcutRecording);

  resetShortcutButton.addEventListener("click", async () => {
    if (saving || recordingShortcut) return;
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

  testTabSwitcherButton.addEventListener("click", async () => {
    if (recordingShortcut) return;
    try {
      await chrome.runtime.sendMessage({ type: "OPEN_TAB_SWITCHER" });
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

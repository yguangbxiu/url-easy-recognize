const DEFAULT_TAB_SWITCHER_SHORTCUT = {
  ctrl: false,
  shift: true,
  alt: false,
  meta: true,
  key: "g",
};

const DEFAULT_HISTORY_SWITCHER_SHORTCUT = {
  ctrl: false,
  shift: true,
  alt: false,
  meta: true,
  key: "h",
};

const DEFAULT_TAB_SWITCHER = {
  enabled: true,
  shortcut: { ...DEFAULT_TAB_SWITCHER_SHORTCUT },
  historyShortcut: { ...DEFAULT_HISTORY_SWITCHER_SHORTCUT },
};

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent);
}

function matchesShortcut(event, shortcut) {
  if (!shortcut?.key) return false;
  return (
    event.ctrlKey === !!shortcut.ctrl &&
    event.shiftKey === !!shortcut.shift &&
    event.altKey === !!shortcut.alt &&
    event.metaKey === !!shortcut.meta &&
    event.key.toLowerCase() === shortcut.key.toLowerCase()
  );
}

function formatShortcut(shortcut) {
  if (!shortcut?.key) return "";

  const parts = [];
  const mac = isMacPlatform();

  if (shortcut.ctrl) parts.push(mac ? "Ctrl" : "Ctrl");
  if (shortcut.alt) parts.push(mac ? "Option" : "Alt");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.meta) parts.push(mac ? "Cmd" : "Win");

  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);
  return parts.join("+");
}

function mergeTabSwitcherSettings(stored) {
  const tabSwitcher = { ...DEFAULT_TAB_SWITCHER, ...(stored?.tabSwitcher ?? {}) };
  tabSwitcher.shortcut = {
    ...DEFAULT_TAB_SWITCHER.shortcut,
    ...(stored?.tabSwitcher?.shortcut ?? {}),
  };
  tabSwitcher.historyShortcut = {
    ...DEFAULT_TAB_SWITCHER.historyShortcut,
    ...(stored?.tabSwitcher?.historyShortcut ?? {}),
  };

  const shortcut = tabSwitcher.shortcut;
  if (shortcut.meta && !shortcut.shift && !shortcut.ctrl && !shortcut.alt && shortcut.key === "g") {
    tabSwitcher.shortcut = { ...DEFAULT_TAB_SWITCHER.shortcut };
  }

  const historyShortcut = tabSwitcher.historyShortcut;
  if (
    historyShortcut.meta &&
    !historyShortcut.shift &&
    !historyShortcut.ctrl &&
    !historyShortcut.alt &&
    historyShortcut.key === "h"
  ) {
    tabSwitcher.historyShortcut = { ...DEFAULT_TAB_SWITCHER.historyShortcut };
  }

  return tabSwitcher;
}

function captureShortcutFromEvent(event) {
  const key = event.key;
  if (!key || key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") {
    return null;
  }

  const shortcut = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    key: key.length === 1 ? key.toLowerCase() : key,
  };

  if (!shortcut.ctrl && !shortcut.shift && !shortcut.alt && !shortcut.meta) {
    return null;
  }

  return shortcut;
}

function shortcutToChromeCommand(shortcut) {
  if (!shortcut?.key) return "";

  const mac = isMacPlatform();
  const parts = [];

  if (shortcut.meta) {
    parts.push(mac ? "Command" : "Ctrl");
  }
  if (shortcut.ctrl) {
    parts.push(mac ? "MacCtrl" : "Ctrl");
  }
  if (shortcut.alt) {
    parts.push("Alt");
  }
  if (shortcut.shift) {
    parts.push("Shift");
  }

  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);
  return parts.join("+");
}

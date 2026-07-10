const SETTINGS_KEY = "settings";

const DEFAULTS = {
  enabled: true,
  lengthMode: "all",
  customLength: 10,
};

const enabledRadios = document.querySelectorAll('input[name="enabled"]');
const lengthRadios = document.querySelectorAll('input[name="lengthMode"]');
const lengthSection = document.getElementById("length-section");
const customLengthInput = document.getElementById("customLength");

let currentSettings = { ...DEFAULTS };
let saving = false;

async function readSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(result[SETTINGS_KEY] ?? {}) };
}

async function writeSettings(partial) {
  currentSettings = { ...currentSettings, ...partial };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: currentSettings });
}

function updateLengthSectionState() {
  const enabled = currentSettings.enabled;
  lengthSection.classList.toggle("disabled", !enabled);
  customLengthInput.disabled = !enabled || currentSettings.lengthMode !== "custom";
}

function syncFormFromSettings() {
  for (const radio of enabledRadios) {
    radio.checked = radio.value === String(currentSettings.enabled);
  }
  for (const radio of lengthRadios) {
    radio.checked = radio.value === currentSettings.lengthMode;
  }
  customLengthInput.value = currentSettings.customLength;
  updateLengthSectionState();
}

async function init() {
  currentSettings = await readSettings();
  syncFormFromSettings();

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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return;
    currentSettings = { ...DEFAULTS, ...changes[SETTINGS_KEY].newValue };
    syncFormFromSettings();
  });
}

init();

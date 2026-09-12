import { loadEnrichmentOptions } from "./features.js";
import { renderAssignedShortcut } from "./shortcut.js";

const SETTINGS_KEY = "phraselet.settings";

const afterSaveEl = document.querySelector("#after-save");
const saveEl = document.querySelector("#save-options");
const statusEl = document.querySelector("#status");
const onboardingEl = document.querySelector("#view-onboarding");
const changeShortcutEl = document.querySelector("#change-shortcut");
let enrichmentOptions = null;

document.addEventListener("DOMContentLoaded", init);
saveEl.addEventListener("click", saveOptions);
onboardingEl.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("onboarding.html")
  });
});
changeShortcutEl.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

async function init() {
  renderAssignedShortcut();
  const settings = await getSettings();
  afterSaveEl.value = normalizeAfterSave(settings.afterSave);

  const module = await loadEnrichmentOptions();
  enrichmentOptions = module?.mountEnrichmentOptions({ settings, showStatus }) || null;
}

async function saveOptions() {
  saveEl.disabled = true;
  try {
    const settings = await getSettings();
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...settings,
        ...enrichmentOptions?.values(),
        afterSave: normalizeAfterSave(afterSaveEl.value)
      }
    });
    showStatus("Options saved.");
  } finally {
    saveEl.disabled = false;
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    afterSave: "confirmation",
    ...result[SETTINGS_KEY]
  };
}

function normalizeAfterSave(value) {
  return value === "open_popup" ? "open_popup" : "confirmation";
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

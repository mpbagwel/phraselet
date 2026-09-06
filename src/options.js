const SETTINGS_KEY = "pausemark.settings";

const apiKeyEl = document.querySelector("#api-key");
const modelEl = document.querySelector("#model");
const afterSaveEl = document.querySelector("#after-save");
const saveEl = document.querySelector("#save-options");
const clearEl = document.querySelector("#clear-key");
const statusEl = document.querySelector("#status");

document.addEventListener("DOMContentLoaded", loadOptions);
saveEl.addEventListener("click", saveOptions);
clearEl.addEventListener("click", clearKey);

async function loadOptions() {
  const settings = await getSettings();
  apiKeyEl.value = settings.apiKey || "";
  modelEl.value = settings.model || "gpt-4.1-mini";
  afterSaveEl.value = normalizeAfterSave(settings.afterSave);
}

async function saveOptions() {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim() || "gpt-4.1-mini",
      afterSave: normalizeAfterSave(afterSaveEl.value)
    }
  });
  showStatus("Options saved.");
}

async function clearKey() {
  const settings = await getSettings();
  apiKeyEl.value = "";
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...settings,
      apiKey: ""
    }
  });
  showStatus("API key cleared.");
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    apiKey: "",
    model: "gpt-4.1-mini",
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

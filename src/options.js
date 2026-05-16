const SETTINGS_KEY = "pausemark.settings";

const apiKeyEl = document.querySelector("#api-key");
const modelEl = document.querySelector("#model");
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
}

async function saveOptions() {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim() || "gpt-4.1-mini"
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
    ...result[SETTINGS_KEY]
  };
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

const SETTINGS_KEY = "pausemark.settings";

const apiKeyEl = document.querySelector("#api-key");
const modelEl = document.querySelector("#model");
const afterSaveEl = document.querySelector("#after-save");
const saveEl = document.querySelector("#save-options");
const clearEl = document.querySelector("#clear-key");
const toggleKeyEl = document.querySelector("#toggle-key");
const statusEl = document.querySelector("#status");
const onboardingEl = document.querySelector("#view-onboarding");

document.addEventListener("DOMContentLoaded", loadOptions);
saveEl.addEventListener("click", saveOptions);
clearEl.addEventListener("click", clearKey);
toggleKeyEl.addEventListener("click", toggleKeyVisibility);
onboardingEl.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("onboarding.html")
  });
});

async function loadOptions() {
  const settings = await getSettings();
  apiKeyEl.value = settings.apiKey || "";
  modelEl.value = settings.model || "gpt-4.1-mini";
  afterSaveEl.value = normalizeAfterSave(settings.afterSave);
}

async function saveOptions() {
  saveEl.disabled = true;
  try {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        apiKey: apiKeyEl.value.trim().slice(0, 500),
        model: modelEl.value.trim().slice(0, 100) || "gpt-4.1-mini",
        afterSave: normalizeAfterSave(afterSaveEl.value)
      }
    });
    showStatus("Options saved.");
  } finally {
    saveEl.disabled = false;
  }
}

async function clearKey() {
  const settings = await getSettings();
  apiKeyEl.value = "";
  setKeyVisibility(false);
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...settings,
      apiKey: ""
    }
  });
  showStatus("API key cleared.");
}

function toggleKeyVisibility() {
  setKeyVisibility(apiKeyEl.type === "password");
}

function setKeyVisibility(isVisible) {
  apiKeyEl.type = isVisible ? "text" : "password";
  toggleKeyEl.textContent = isVisible ? "Hide" : "Show";
  toggleKeyEl.setAttribute("aria-label", `${isVisible ? "Hide" : "Show"} API key`);
  toggleKeyEl.setAttribute("aria-pressed", String(isVisible));
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

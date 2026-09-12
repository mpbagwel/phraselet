import { loadEnrichmentOnboarding } from "./features.js";
import { renderAssignedShortcut } from "./shortcut.js";

const ONBOARDING_KEY = "phraselet.onboarding";

const finishEl = document.querySelector("#onboarding-finish");
const settingsEl = document.querySelector("#onboarding-settings");
const statusEl = document.querySelector("#onboarding-status");

renderAssignedShortcut();
applyOptionalOnboardingCopy();

finishEl.addEventListener("click", finishOnboarding);
settingsEl.addEventListener("click", openSettings);

async function finishOnboarding() {
  finishEl.disabled = true;

  try {
    await chrome.storage.local.set({
      [ONBOARDING_KEY]: {
        completed: true,
        completedAt: new Date().toISOString()
      }
    });

    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) {
      await chrome.tabs.remove(tab.id);
      return;
    }

    statusEl.textContent = "You're ready. You can close this page.";
  } catch {
    statusEl.textContent = "You're ready. You can close this page.";
    finishEl.disabled = false;
  }
}

async function openSettings() {
  settingsEl.disabled = true;
  try {
    await chrome.runtime.openOptionsPage();
  } finally {
    settingsEl.disabled = false;
  }
}

async function applyOptionalOnboardingCopy() {
  const module = await loadEnrichmentOnboarding();
  module?.applyEnrichmentOnboardingCopy();
}

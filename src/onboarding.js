import { FEATURES } from "./features.js";
import { renderAssignedShortcut } from "./shortcut.js";

const ONBOARDING_KEY = "phraselet.onboarding";

const finishEl = document.querySelector("#onboarding-finish");
const settingsEl = document.querySelector("#onboarding-settings");
const statusEl = document.querySelector("#onboarding-status");

renderAssignedShortcut();

if (FEATURES.aiEnrichment) {
  document.querySelector("#onboarding-third-title").textContent = "Explain when you want";
  document.querySelector("#onboarding-third-copy").textContent = "AI explanations are optional. Add your own OpenAI API key in Settings if you want contextual definitions and examples.";
  document.querySelector("#privacy-title").textContent = "Your data and AI";
  document.querySelector("#privacy-copy").textContent = "Saved phrases, nearby context, page titles, URLs, notes, tags, and your optional API key are stored in Chrome on this device. When AI explanations are enabled, the phrase, nearby context, page title, and site hostname are sent to OpenAI without asking OpenAI to retain the generated response.";
}

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

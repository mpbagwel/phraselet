const SETTINGS_KEY = "phraselet.settings";

export function mountEnrichmentOptions({ settings, showStatus }) {
  const slot = document.querySelector("#enrichment-settings-slot");
  const actions = document.querySelector("#settings-actions");
  const captureNumber = document.querySelector("#capture-section-number");

  slot.innerHTML = `
    <div class="settings-section">
      <div class="section-heading">
        <span class="section-number">01</span>
        <div>
          <h2>AI explanations</h2>
          <p>Optional context, examples, and related terms for every phrase.</p>
        </div>
      </div>
      <div class="field-group">
        <label for="api-key">OpenAI API key</label>
        <div class="password-field">
          <input id="api-key" type="password" autocomplete="off" maxlength="500" placeholder="sk-…" aria-describedby="api-key-help">
          <button id="toggle-key" class="text-button field-action" type="button" aria-label="Show API key" aria-pressed="false">Show</button>
        </div>
        <p id="api-key-help" class="field-help">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/></svg>
          Stored only in extension storage on this device. Treat it like a password.
        </p>
      </div>
      <div class="field-group">
        <label for="model">Model</label>
        <input id="model" type="text" autocomplete="off" maxlength="100" value="gpt-4.1-mini" aria-describedby="model-help">
        <p id="model-help" class="field-help">Use any model available to your API key.</p>
      </div>
    </div>
  `;

  const clearKey = document.createElement("button");
  clearKey.id = "clear-key";
  clearKey.className = "secondary-button";
  clearKey.type = "button";
  clearKey.textContent = "Clear API key";
  actions.prepend(clearKey);
  captureNumber.textContent = "02";

  const apiKey = document.querySelector("#api-key");
  const model = document.querySelector("#model");
  const toggleKey = document.querySelector("#toggle-key");
  apiKey.value = settings.apiKey || "";
  model.value = settings.model || "gpt-4.1-mini";

  toggleKey.addEventListener("click", () => {
    const isVisible = apiKey.type === "password";
    apiKey.type = isVisible ? "text" : "password";
    toggleKey.textContent = isVisible ? "Hide" : "Show";
    toggleKey.setAttribute("aria-label", `${isVisible ? "Hide" : "Show"} API key`);
    toggleKey.setAttribute("aria-pressed", String(isVisible));
  });

  clearKey.addEventListener("click", async () => {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    apiKey.value = "";
    apiKey.type = "password";
    toggleKey.textContent = "Show";
    toggleKey.setAttribute("aria-label", "Show API key");
    toggleKey.setAttribute("aria-pressed", "false");
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...result[SETTINGS_KEY],
        apiKey: ""
      }
    });
    showStatus("API key cleared.");
  });

  return {
    values() {
      return {
        apiKey: apiKey.value.trim().slice(0, 500),
        model: model.value.trim().slice(0, 100) || "gpt-4.1-mini"
      };
    }
  };
}

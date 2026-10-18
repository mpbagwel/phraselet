const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadOptions(failure) {
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const state = { failure, settings: { afterSave: "confirmation", otherPreference: "keep" } };
  const context = vm.createContext({
    document: {
      addEventListener() {},
      querySelector(selector) {
        if (!elements.has(selector)) {
          const classes = new Set();
          elements.set(selector, {
            addEventListener() {}, value: "open_popup", disabled: false, textContent: "",
            classList: {
              toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
              contains(name) { return classes.has(name); }
            }
          });
        }
        return elements.get(selector);
      }
    },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { storage: { local: {
      async get() {
        if (state.failure === "read") throw new Error("Read failed");
        return { "phraselet.settings": structuredClone(state.settings) };
      },
      async set(values) {
        if (state.failure === "write") throw new Error("Write failed");
        state.settings = structuredClone(values["phraselet.settings"]);
      }
    } } }
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/options.js"), "utf8");
  vm.runInContext(source.replace(/import\s+\{[^}]*\}\s+from\s+"[^"]+";/g, ""), context);
  return { context, elements, timers, state };
}

for (const failure of ["read", "write"]) {
  test(`settings ${failure} failures remain visible and allow a successful retry`, async () => {
    const app = loadOptions(failure);
    const status = app.elements.get("#status");
    const save = app.elements.get("#save-options");
    await app.context.saveOptions();
    assert.equal(status.textContent, "Could not save preferences. Try again");
    assert.equal(status.classList.contains("is-error"), true);
    assert.equal(save.disabled, false);
    assert.equal(app.timers.size, 0, "Failure must not disappear on a success-message timer");
    assert.equal(app.state.settings.afterSave, "confirmation");

    app.state.failure = null;
    await app.context.saveOptions();
    assert.equal(status.textContent, "Preferences saved");
    assert.equal(status.classList.contains("is-error"), false);
    assert.equal(save.disabled, false);
    assert.deepEqual(app.state.settings, { afterSave: "open_popup", otherPreference: "keep" });
  });
}

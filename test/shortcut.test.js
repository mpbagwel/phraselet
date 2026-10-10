const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadShortcut(commands, { preview = false, unavailable = false } = {}) {
  const attributes = {};
  const label = { textContent: "Option+Shift+P", setAttribute(name, value) { attributes[name] = value; } };
  const help = { hidden: true };
  const button = { addEventListener(event, handler) { this[event] = handler; } };
  const openedTabs = [];
  const elements = {
    "[data-shortcut-label]": [label],
    "[data-shortcut-help]": [help],
    "[data-set-shortcut]": [button]
  };
  const context = vm.createContext({
    document: { querySelectorAll(selector) { return elements[selector] || []; } },
    ...preview ? {} : { chrome: {
      commands: { async getAll() {
        if (unavailable) throw new Error("Unavailable");
        return commands;
      } },
      tabs: { create(tab) { openedTabs.push(tab.url); } }
    } }
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/shortcut.js"), "utf8");
  vm.runInContext(source.replace("export async function", "async function"), context);
  return { context, label, help, button, openedTabs, attributes };
}

test("the actual customized shortcut takes precedence over the manifest fallback", async () => {
  const app = loadShortcut([{ name: "save-selected-snippet", shortcut: "Ctrl+Shift+Y" }]);
  await app.context.renderAssignedShortcut();
  assert.equal(app.label.textContent, "Ctrl+Shift+Y");
  assert.equal(app.attributes["aria-label"], "Ctrl+Shift+Y");
  assert.equal(app.help.hidden, true);
});

test("Windows and Mac representations of the default use the Mac key name", async () => {
  for (const shortcut of ["Alt+Shift+P", "Option+Shift+P", "⌥⇧P", "⇧⌥P", "⌥+⇧+P"]) {
    const app = loadShortcut([{ name: "save-selected-snippet", shortcut }]);
    await app.context.renderAssignedShortcut();
    assert.equal(app.label.textContent, "Option+Shift+P");
    assert.equal(app.attributes["aria-label"], "Option+Shift+P");
    assert.equal(app.help.hidden, true);
  }
});

test("unassigned or missing commands show setup guidance that opens Chrome shortcuts", async () => {
  for (const commands of [[], [{ name: "save-selected-snippet", shortcut: "" }]]) {
    const app = loadShortcut(commands);
    await app.context.renderAssignedShortcut();
    assert.equal(app.label.textContent, "Not assigned");
    assert.equal(app.help.hidden, false);
    app.button.click();
    assert.deepEqual(app.openedTabs, ["chrome://extensions/shortcuts"]);
  }
});

test("local previews and failed command lookups retain the fallback without claiming a conflict", async () => {
  for (const options of [{ preview: true }, { unavailable: true }]) {
    const app = loadShortcut([], options);
    await app.context.renderAssignedShortcut();
    assert.equal(app.label.textContent, "Option+Shift+P");
    assert.equal(app.help.hidden, true);
  }
});

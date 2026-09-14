const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPopup(response = { ok: true, added: 1, updated: 0 }) {
  const elements = new Map();
  const messages = [];
  const writes = [];
  const document = {
    addEventListener() {},
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        addEventListener() {}, classList: { toggle() {}, remove() {} }, textContent: ""
      });
      return elements.get(selector);
    }
  };
  const context = vm.createContext({
    document, URL, Error, SyntaxError, setTimeout() {},
    FEATURES: { aiEnrichment: false }, MAX_IMPORT_FILE_BYTES: 32 * 1024 * 1024,
    chrome: {
      runtime: { async sendMessage(message) { messages.push(structuredClone(message)); return response; } },
      storage: { local: { async set(value) { writes.push(value); } } }
    }
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/popup.js"), "utf8");
  vm.runInContext(source.replace(/import\s+\{[^}]*\}\s+from\s+"[^"]+";/g, ""), context);
  return { context, elements, messages, writes };
}

test("popup edits send only changed fields and never write a cached library", async () => {
  const app = loadPopup();
  vm.runInContext('cards = [{id: "one", selectedText: "First", contextText: "Context", sourceTitle: "Title", note: "Before", tags: ["keep"]}]', app.context);
  const values = { selectedText: "First", contextText: "Context", sourceTitle: "Title", note: "After" };
  await app.context.saveCardEdits({ dataset: { id: "one" }, elements: { namedItem: (name) => ({ value: values[name] }) } });
  assert.deepEqual(app.messages, [{ type: "PHRASELET_UPDATE_CARD", cardId: "one", changes: { note: "After" } }]);
  assert.deepEqual(app.writes, []);
});

test("popup import accepts backups above 5 MiB without resetting the full-backup reminder", async () => {
  const app = loadPopup();
  const payload = { schemaVersion: 3, cards: [{ id: "one", selectedText: "First" }] };
  app.elements.get("#import-file").files = [{ size: 6 * 1024 * 1024, text: async () => JSON.stringify(payload) }];
  await app.context.importCards();
  assert.deepEqual(app.messages, [{ type: "PHRASELET_IMPORT_CARDS", payload }]);
  assert.deepEqual(app.writes, []);
  assert.equal(app.elements.get("#library-status").textContent, "Import complete: 1 added");
});

test("popup rejects over-limit files before reading and shows worker failures", async () => {
  const app = loadPopup({ ok: false, error: "Library is full" });
  app.elements.get("#import-file").files = [{ size: 33 * 1024 * 1024, text() { assert.fail("Must not read oversized file"); } }];
  await app.context.importCards();
  assert.equal(app.messages.length, 0);
  assert.match(app.elements.get("#library-status").textContent, /32 MB/);
  app.elements.get("#import-file").files = [{ size: 100, text: async () => '{"cards":[]}' }];
  await app.context.importCards();
  assert.equal(app.elements.get("#library-status").textContent, "Library is full");
  assert.deepEqual(app.writes, []);
});

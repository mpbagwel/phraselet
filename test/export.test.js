const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const exportSource = fs.readFileSync(path.resolve(__dirname, "../src/export.js"), "utf8");

function loadExportModule() {
  const context = { Date };
  const runnableSource = exportSource
    .replace("export const EXPORT_SCHEMA_VERSION", "const EXPORT_SCHEMA_VERSION")
    .replace("export function createExportPayload", "function createExportPayload");
  vm.runInNewContext(
    `${runnableSource}\nthis.exports = { EXPORT_SCHEMA_VERSION, createExportPayload };`,
    context,
    { filename: "src/export.js" }
  );
  return context.exports;
}

test("base exports use a neutral schema and omit empty enrichment metadata", () => {
  const { createExportPayload, EXPORT_SCHEMA_VERSION } = loadExportModule();
  const payload = createExportPayload([{
    id: "one",
    selectedText: "A phrase",
    status: "learning",
    ai: {
      status: "not_requested",
      summary: "",
      contextMeaning: "",
      examples: [],
      relatedTerms: []
    }
  }], "2026-09-12T00:00:00.000Z");

  assert.equal(EXPORT_SCHEMA_VERSION, 2);
  assert.equal(payload.cards[0].ai, undefined);
  assert.equal(payload.cards[0].enrichment, undefined);
});

test("existing enrichment is preserved under a provider-neutral field", () => {
  const { createExportPayload } = loadExportModule();
  const payload = createExportPayload([{
    id: "one",
    selectedText: "A phrase",
    ai: {
      status: "enriched",
      summary: "A saved explanation.",
      examples: []
    }
  }], "2026-09-12T00:00:00.000Z");
  const serialized = JSON.stringify(payload);

  assert.equal(payload.cards[0].ai, undefined);
  assert.equal(payload.cards[0].enrichment.summary, "A saved explanation.");
  assert.doesNotMatch(serialized, /"ai"/);
});

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
    .replace("export function createExportPayload", "function createExportPayload")
    .replace("export function createExportFile", "function createExportFile")
    .replace("export function createMarkdownExport", "function createMarkdownExport")
    .replace("export function createCsvExport", "function createCsvExport")
    .replace("export function createPlainTextExport", "function createPlainTextExport");
  vm.runInNewContext(
    `${runnableSource}\nthis.exports = { EXPORT_SCHEMA_VERSION, createExportPayload, createExportFile, createMarkdownExport, createCsvExport, createPlainTextExport };`,
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
    status: "current",
    ai: {
      status: "not_requested",
      summary: "",
      contextMeaning: "",
      examples: [],
      relatedTerms: []
    }
  }], "2026-09-12T00:00:00.000Z");

  assert.equal(EXPORT_SCHEMA_VERSION, 3);
  assert.equal(payload.cards[0].ai, undefined);
  assert.equal(payload.cards[0].enrichment, undefined);
});

test("Markdown exports preserve useful phrase context in a readable structure", () => {
  const { createMarkdownExport } = loadExportModule();
  const output = createMarkdownExport([{
    selectedText: "Language makes a world.",
    contextText: "A surrounding sentence.",
    sourceTitle: "Notes on language",
    sourceUrl: "https://example.com/language",
    createdAt: "2026-09-12T00:00:00.000Z",
    status: "archived",
    note: "Return to *this* idea.",
    tags: ["philosophy", "language"]
  }], "2026-09-13T00:00:00.000Z");

  assert.match(output, /^# Phraselet export/m);
  assert.match(output, /> Language makes a world\./);
  assert.match(output, /State: Archived/);
  assert.match(output, /Tags: philosophy, language/);
  assert.match(output, /Return to \\\*this\\\* idea\./);
  assert.match(output, /https:\/\/example\.com\/language/);
});

test("CSV exports quote fields, retain Unicode, and neutralize spreadsheet formulas", () => {
  const { createCsvExport } = loadExportModule();
  const output = createCsvExport([{
    selectedText: "=IMPORTXML(\"https://example.com\")",
    contextText: "Café, context",
    sourceTitle: "A \"quoted\" title",
    status: "current",
    tags: ["one", "two"]
  }]);

  assert.equal(output.startsWith("\uFEFF"), true);
  assert.match(output, /"'=IMPORTXML\(""https:\/\/example\.com""\)"/);
  assert.match(output, /"Café, context"/);
  assert.match(output, /"A ""quoted"" title"/);
  assert.match(output, /"one; two"/);
});

test("plain-text copy includes only the selected phrase text", () => {
  const { createPlainTextExport } = loadExportModule();
  assert.equal(createPlainTextExport([
    { selectedText: "First phrase", note: "Do not copy this note" },
    { selectedText: "Second phrase", contextText: "Do not copy this context" }
  ]), "First phrase\n\nSecond phrase");
});

test("export files use the expected portable extensions and MIME types", () => {
  const { createExportFile } = loadExportModule();
  const cards = [{ selectedText: "A phrase", status: "current" }];

  assert.equal(createExportFile(cards, "json").extension, "json");
  assert.equal(createExportFile(cards, "markdown").extension, "md");
  assert.equal(createExportFile(cards, "csv").mimeType, "text/csv;charset=utf-8");
  assert.throws(() => createExportFile(cards, "pdf"), /not supported/);
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

test("legacy learning states export as current lifecycle values", () => {
  const { createExportPayload } = loadExportModule();
  const payload = createExportPayload([{ selectedText: "A phrase", status: "learning" }]);

  assert.equal(payload.cards[0].status, "current");
});

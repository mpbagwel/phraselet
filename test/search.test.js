const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const searchSource = fs.readFileSync(path.resolve(__dirname, "../src/search.js"), "utf8");

function loadSearch() {
  const context = {};
  vm.runInNewContext(
    `${searchSource.replace("export function rankCards", "function rankCards")}\nthis.rankCards = rankCards;`,
    context,
    { filename: "src/search.js" }
  );
  return context.rankCards;
}

test("search ranks exact phrases ahead of contextual matches", () => {
  const rankCards = loadSearch();
  const cards = [
    { id: "context", selectedText: "Other", contextText: "A serendipity example", tags: [] },
    { id: "exact", selectedText: "Serendipity", contextText: "", tags: [] }
  ];

  assert.deepEqual(rankCards(cards, { query: "serendipity" }).map(({ id }) => id), [
    "exact",
    "context"
  ]);
});

test("search tolerates small phrase typos and searches notes", () => {
  const rankCards = loadSearch();
  const cards = [
    { id: "phrase", selectedText: "Serendipity", note: "", tags: [] },
    { id: "note", selectedText: "Another phrase", note: "Use in the quarterly memo", tags: [] }
  ];

  assert.deepEqual(rankCards(cards, { query: "serendipty" }).map(({ id }) => id), ["phrase"]);
  assert.deepEqual(rankCards(cards, { query: "quarterly" }).map(({ id }) => id), ["note"]);
});

test("status and tag filters compose with search", () => {
  const rankCards = loadSearch();
  const cards = [
    { id: "known", selectedText: "Luminous", status: "known", tags: ["Writing"] },
    { id: "learning", selectedText: "Luminous", status: "learning", tags: ["Writing"] },
    { id: "other", selectedText: "Luminous", status: "known", tags: ["Science"] }
  ];

  assert.deepEqual(rankCards(cards, {
    query: "luminos",
    tag: "writing",
    status: "known"
  }).map(({ id }) => id), ["known"]);
});

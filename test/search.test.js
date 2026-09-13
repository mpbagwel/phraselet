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

test("archive and tag filters compose with search", () => {
  const rankCards = loadSearch();
  const cards = [
    { id: "archived", selectedText: "Luminous", status: "archived", tags: ["Writing"] },
    { id: "current", selectedText: "Luminous", status: "current", tags: ["Writing"] },
    { id: "other", selectedText: "Luminous", status: "archived", tags: ["Science"] }
  ];

  assert.deepEqual(rankCards(cards, {
    query: "luminos",
    tag: "writing",
    status: "archived"
  }).map(({ id }) => id), ["archived"]);
});

test("legacy known and learning states map to archived and current views", () => {
  const rankCards = loadSearch();
  const cards = [
    { id: "known", selectedText: "One", status: "known", tags: [] },
    { id: "learning", selectedText: "Two", status: "learning", tags: [] }
  ];

  assert.deepEqual(rankCards(cards, { status: "archived" }).map(({ id }) => id), ["known"]);
  assert.deepEqual(rankCards(cards, { status: "current" }).map(({ id }) => id), ["learning"]);
});

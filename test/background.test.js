const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(projectRoot, "src/background.js"), "utf8");
const enrichmentBackgroundSource = fs.readFileSync(path.join(projectRoot, "src/enrichment/background.js"), "utf8");
const openAiSource = fs.readFileSync(path.join(projectRoot, "src/enrichment/openai.js"), "utf8");
const librarySource = fs.readFileSync(path.join(projectRoot, "src/library.js"), "utf8");

function loadBackground({
  fetchImplementation = fetch,
  injectedResult = null,
  injectionError = null,
  initialCards = null,
  initialSettings = null,
  legacyCards = null,
  legacySettings = null,
  aiEnrichment = true,
  beforeCardsWrite = async () => {}
} = {}) {
  const localStorage = initialCards
    ? { "phraselet.cards": structuredClone(initialCards) }
    : {};
  if (initialSettings) {
    localStorage["phraselet.settings"] = structuredClone(initialSettings);
  }
  if (legacyCards) {
    localStorage["pausemark.cards"] = structuredClone(legacyCards);
  }
  if (legacySettings) {
    localStorage["pausemark.settings"] = structuredClone(legacySettings);
  }
  const sessionStorage = {};
  const badgeTexts = [];
  const createdTabs = [];
  const storageAccessLevels = [];
  let commandHandler;
  let installedHandler;
  let runtimeMessageHandler;

  const storageArea = (state) => ({
    async get(keys) {
      const requestedKeys = Array.isArray(keys) ? keys : [keys];
      return structuredClone(Object.fromEntries(requestedKeys.map((key) => [key, state[key]])));
    },
    async set(values) {
      if (values["phraselet.cards"]) await beforeCardsWrite(values["phraselet.cards"]);
      Object.assign(state, structuredClone(values));
    },
    async remove(keys) {
      const removedKeys = Array.isArray(keys) ? keys : [keys];
      removedKeys.forEach((key) => delete state[key]);
    },
    async setAccessLevel(options) {
      storageAccessLevels.push(options);
    }
  });

  const chrome = {
    action: {
      async openPopup() {},
      async setBadgeBackgroundColor() {},
      async setBadgeText({ text }) {
        badgeTexts.push(text);
      }
    },
    commands: {
      onCommand: {
        addListener(listener) {
          commandHandler = listener;
        }
      }
    },
    contextMenus: {
      create() {},
      onClicked: { addListener() {} }
    },
    runtime: {
      getURL(pathname) {
        return `chrome-extension://phraselet/${pathname}`;
      },
      onInstalled: {
        addListener(listener) {
          installedHandler = listener;
        }
      },
      onMessage: {
        addListener(listener) {
          runtimeMessageHandler = listener;
        }
      }
    },
    scripting: {
      async executeScript() {
        if (injectionError) {
          throw injectionError;
        }
        return [{ result: injectedResult }];
      }
    },
    storage: {
      local: storageArea(localStorage),
      session: storageArea(sessionStorage)
    },
    tabs: {
      async create(options) {
        createdTabs.push(options);
      },
      async query() {
        return [{ id: 17, title: "Example", url: "https://example.com/article" }];
      },
      async sendMessage() {
        throw new Error("Receiving end does not exist");
      }
    }
  };

  const context = vm.createContext({
    chrome,
    console,
    crypto: webcrypto,
    fetch: fetchImplementation,
    AbortController,
    clearTimeout,
    setTimeout,
    TextEncoder,
    URL
  });
  const providerSource = `(function () {\n${openAiSource.replace(
    "export async function requestExplanation",
    "async function requestExplanation"
  )}\nglobalThis.__requestExplanation = requestExplanation;\n})();`;
  const enrichmentRuntimeSource = `(function () {\n${enrichmentBackgroundSource
    .replace('import { requestExplanation } from "./openai.js";', "const requestExplanation = globalThis.__requestExplanation;")
    .replace("export function createEnrichmentRuntime", "function createEnrichmentRuntime")}\nglobalThis.__createEnrichmentRuntime = createEnrichmentRuntime;\n})();`;
  vm.runInContext(`(function () {\n${librarySource
    .replace('import { EXPORT_SCHEMA_VERSION } from "./export.js";', 'const EXPORT_SCHEMA_VERSION = 3;')
    .replaceAll('export ', '')}\nglobalThis.__library = { MAX_LIBRARY_BYTES, MAX_LIBRARY_CARDS, MAX_IMPORT_FILE_BYTES, prepareImportedCards, mergeImportedCards };\n})();`, context);
  const runnableBackgroundSource = backgroundSource.replace(
    'import { FEATURES, loadEnrichmentRuntime } from "./features.js";',
    `const FEATURES = Object.freeze({ aiEnrichment: ${aiEnrichment} });\nconst loadEnrichmentRuntime = async () => FEATURES.aiEnrichment ? ({ createEnrichmentRuntime: globalThis.__createEnrichmentRuntime }) : null;`
  ).replace('import { MAX_LIBRARY_BYTES, MAX_LIBRARY_CARDS, MAX_IMPORT_FILE_BYTES, prepareImportedCards, mergeImportedCards } from "./library.js";',
    'const { MAX_LIBRARY_BYTES, MAX_LIBRARY_CARDS, MAX_IMPORT_FILE_BYTES, prepareImportedCards, mergeImportedCards } = globalThis.__library;');
  vm.runInContext(providerSource, context, { filename: "src/enrichment/openai.js" });
  vm.runInContext(enrichmentRuntimeSource, context, { filename: "src/enrichment/background.js" });
  vm.runInContext(runnableBackgroundSource, context, { filename: "src/background.js" });

  return {
    badgeTexts,
    chrome,
    commandHandler,
    createdTabs,
    installedHandler,
    localStorage,
    runtimeMessageHandler,
    storageAccessLevels,
    ready: vm.runInContext("storageMigrationPromise", context)
  };
}

function captureFromPopup(runtimeMessageHandler) {
  return sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_SAVE_ACTIVE_SELECTION"
  });
}

test("a pending capture and popup edit retain both changes", async () => {
  let enterWrite;
  let releaseWrite;
  const entered = new Promise((resolve) => { enterWrite = resolve; });
  const released = new Promise((resolve) => { releaseWrite = resolve; });
  const app = loadBackground({
    aiEnrichment: false,
    initialCards: [{ id: "existing", selectedText: "Existing", status: "current", tags: [] }],
    injectedResult: { selectedText: "New capture", sourceUrl: "https://example.com/new" },
    beforeCardsWrite: async (cards) => {
      if (cards.some((card) => card.selectedText === "New capture") && !cards.find((card) => card.id === "existing")?.note) {
        enterWrite();
        await released;
      }
    }
  });
  await app.ready;
  const capture = captureFromPopup(app.runtimeMessageHandler);
  await entered;
  const edit = sendRuntimeMessage(app.runtimeMessageHandler, {
    type: "PHRASELET_UPDATE_CARD", cardId: "existing", changes: { note: "Keep this note" }
  });
  releaseWrite();
  const results = await Promise.all([capture, edit]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(app.localStorage["phraselet.cards"].length, 2);
  assert.equal(app.localStorage["phraselet.cards"].find((card) => card.id === "existing").note, "Keep this note");
});

test("simultaneous captures of the same phrase produce one stable card", async () => {
  const app = loadBackground({ aiEnrichment: false, injectedResult: {
    selectedText: "One phrase", sourceUrl: "https://example.com/same"
  } });
  const results = await Promise.all([
    captureFromPopup(app.runtimeMessageHandler), captureFromPopup(app.runtimeMessageHandler)
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(app.localStorage["phraselet.cards"].length, 1);
  assert.equal(results[0].cardId, results[1].cardId);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
});

test("imports and tag renames merge with the latest library while preserving edits", async () => {
  const app = loadBackground({ aiEnrichment: false, initialCards: [
    { id: "one", selectedText: "First", status: "current", tags: ["old"] }
  ] });
  const requests = [
    { type: "PHRASELET_UPDATE_CARD", cardId: "one", changes: { note: "Retain me" } },
    { type: "PHRASELET_IMPORT_CARDS", payload: { schemaVersion: 2, cards: [
      { id: "one", selectedText: "First", status: "learning", tags: ["imported"] },
      { id: "two", selectedText: "Second", status: "known", tags: ["old"] }
    ] } },
    { type: "PHRASELET_UPDATE_TAG", tag: "old", replacement: "new" },
    { type: "PHRASELET_BULK_UPDATE_CARDS", cardIds: ["one"], operation: "archive" }
  ];
  const results = await Promise.all(requests.map((request) => sendRuntimeMessage(app.runtimeMessageHandler, request)));
  assert.ok(results.every((result) => result.ok));
  const [one, two] = app.localStorage["phraselet.cards"];
  assert.equal(one.note, "Retain me");
  assert.deepEqual(one.tags, ["new", "imported"]);
  assert.deepEqual(two.tags, ["new"]);
  assert.equal(one.status, "archived");
  assert.equal(two.status, "archived");
  assert.deepEqual(structuredClone(results[1]), { ok: true, added: 1, updated: 1 });
});

test("edits cannot resurrect deleted cards and a rejected write does not block later writes", async () => {
  const app = loadBackground({ aiEnrichment: false, initialCards: [
    { id: "deleted", selectedText: "Delete me", status: "current", tags: [] },
    { id: "kept", selectedText: "Keep me", status: "current", tags: [] }
  ] });
  const requests = [
    { type: "PHRASELET_BULK_UPDATE_CARDS", cardIds: ["deleted"], operation: "delete" },
    { type: "PHRASELET_UPDATE_CARD", cardId: "deleted", changes: { note: "Stale edit" } },
    { type: "PHRASELET_UPDATE_CARD", cardId: "kept", changes: { note: "Still works" } }
  ];
  const results = await Promise.all(requests.map((request) => sendRuntimeMessage(app.runtimeMessageHandler, request)));
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /deleted/);
  assert.equal(results[2].ok, true);
  assert.equal(app.localStorage["phraselet.cards"].length, 1);
  assert.equal(app.localStorage["phraselet.cards"][0].note, "Still works");
});

test("editing one field preserves simultaneous tags, archive state, and existing enrichment", async () => {
  const app = loadBackground({ aiEnrichment: false, initialCards: [
    { id: "one", selectedText: "First", status: "current", tags: [], ai: { summary: "Explanation" } }
  ] });
  const requests = [
    { type: "PHRASELET_BULK_UPDATE_CARDS", cardIds: ["one"], operation: "add_tag", tag: "Keep" },
    { type: "PHRASELET_BULK_UPDATE_CARDS", cardIds: ["one"], operation: "archive" },
    { type: "PHRASELET_UPDATE_CARD", cardId: "one", changes: { note: "Edited", status: "current", ai: {}, tags: [] } }
  ];
  const results = await Promise.all(requests.map((request) => sendRuntimeMessage(app.runtimeMessageHandler, request)));
  assert.ok(results.every((result) => result.ok));
  assert.deepEqual(app.localStorage["phraselet.cards"][0], {
    id: "one", selectedText: "First", status: "archived", tags: ["Keep"], ai: { summary: "Explanation" }, note: "Edited"
  });
});

test("large formatted backups restore through the background import handler", async () => {
  const exportSource = fs.readFileSync(path.join(projectRoot, "src/export.js"), "utf8");
  const exports = vm.createContext({});
  vm.runInContext(exportSource.replaceAll("export ", ""), exports);
  const source = Array.from({ length: 2300 }, (_, i) => ({
    id: String(i), selectedText: `Phrase ${i}`, contextText: "x".repeat(1200),
    sourceTitle: "Test", sourceUrl: `https://example.com/${i}`, createdAt: "2026-09-14T00:00:00.000Z",
    status: i % 2 ? "current" : "archived", note: "n".repeat(1800), tags: ["backup"],
    ai: { status: "not_requested", summary: "", contextMeaning: "", examples: [], relatedTerms: [], error: "" }
  }));
  const file = exports.createExportFile(source, "json");
  assert.ok(Buffer.byteLength(file.content) > 5 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(source)) < 8 * 1024 * 1024);
  const app = loadBackground({ aiEnrichment: false });
  const result = await sendRuntimeMessage(app.runtimeMessageHandler, {
    type: "PHRASELET_IMPORT_CARDS", payload: JSON.parse(file.content)
  });
  assert.equal(result.ok, true);
  assert.equal(result.added, source.length);
  assert.equal(app.localStorage["phraselet.cards"].length, source.length);
  source.forEach((card, index) => assert.deepEqual(app.localStorage["phraselet.cards"][index], card));
});

test("imports over the normalized library limit fail without changing existing cards", async () => {
  const app = loadBackground({ aiEnrichment: false, initialCards: [
    { id: "keep", selectedText: "Keep", status: "current", tags: [] }
  ] });
  const payload = { schemaVersion: 3, cards: Array.from({ length: 3000 }, (_, i) => ({
    id: String(i), selectedText: `Phrase ${i}`, contextText: "x".repeat(3000), note: "n".repeat(2000)
  })) };
  const result = await sendRuntimeMessage(app.runtimeMessageHandler, { type: "PHRASELET_IMPORT_CARDS", payload });
  assert.equal(result.ok, false);
  assert.match(result.error, /library is full/);
  assert.deepEqual(app.localStorage["phraselet.cards"], [{ id: "keep", selectedText: "Keep", status: "current", tags: [] }]);
});

function sendRuntimeMessage(runtimeMessageHandler, message) {
  return new Promise((resolve) => {
    const keepChannelOpen = runtimeMessageHandler(
      message,
      {},
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
}

test("shortcut captures through script injection when a reloaded extension has no content script", async () => {
  const selectedText = "selection from an already-open tab";
  const { badgeTexts, commandHandler, localStorage } = loadBackground({
    injectedResult: {
      selectedText,
      contextText: "Context containing the selection from an already-open tab.",
      sourceTitle: "Example",
      sourceUrl: "https://example.com/article"
    }
  });

  commandHandler("save-selected-snippet", {
    id: 17,
    title: "Example",
    url: "https://example.com/article",
    windowId: 2
  });
  for (let attempts = 0; attempts < 10 && !localStorage["phraselet.cards"]; attempts += 1) {
    await new Promise(setImmediate);
  }

  assert.equal(localStorage["phraselet.cards"].length, 1);
  assert.equal(localStorage["phraselet.cards"][0].selectedText, selectedText);
  assert.ok(badgeTexts.includes("1"));
  assert.ok(!badgeTexts.includes("!"));
});

test("returns the selection error when neither messaging nor injection is available", async () => {
  const { localStorage, runtimeMessageHandler } = loadBackground({
    injectionError: new Error("Cannot access a chrome:// URL")
  });

  const result = await captureFromPopup(runtimeMessageHandler);

  assert.equal(result.ok, false);
  assert.equal(result.error, "Select a word or phrase first.");
  assert.equal(localStorage["phraselet.cards"], undefined);
});

test("declares the scripting permission needed by the fallback", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "Phraselet");
  assert.equal(manifest.action.default_title, "Phraselet");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.minimum_chrome_version, "102");
});

test("base build does not register enrichment or auto-enrich new cards", async () => {
  const { localStorage, runtimeMessageHandler } = loadBackground({
    aiEnrichment: false,
    injectedResult: {
      selectedText: "A local phrase",
      contextText: "A local phrase in context.",
      sourceTitle: "Example",
      sourceUrl: "https://example.com"
    }
  });

  const captureResult = await captureFromPopup(runtimeMessageHandler);
  let enrichmentResponded = false;
  const keepsChannelOpen = runtimeMessageHandler(
    { type: "PHRASELET_ENRICH_CARD", cardId: captureResult.cardId },
    {},
    () => {
      enrichmentResponded = true;
    }
  );
  await new Promise(setImmediate);

  assert.equal(captureResult.ok, true);
  assert.equal(localStorage["phraselet.cards"][0].ai.status, "not_requested");
  assert.equal(keepsChannelOpen, false);
  assert.equal(enrichmentResponded, false);
});

test("base build removes stored AI credentials while retaining core settings", async () => {
  const { localStorage } = loadBackground({
    aiEnrichment: false,
    initialSettings: {
      apiKey: "remove-me",
      model: "test-model",
      afterSave: "open_popup"
    }
  });
  await new Promise(setImmediate);

  assert.deepEqual(
    structuredClone(localStorage["phraselet.settings"]),
    { afterSave: "open_popup" }
  );
});

test("limits captured page data before saving it", async () => {
  const { localStorage, runtimeMessageHandler } = loadBackground({
    injectedResult: {
      selectedText: "p".repeat(800),
      contextText: "c".repeat(2000),
      sourceTitle: "t".repeat(500),
      sourceUrl: `https://example.com/${"u".repeat(3000)}`
    }
  });

  const result = await captureFromPopup(runtimeMessageHandler);
  const [card] = localStorage["phraselet.cards"];

  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(card.selectedText.length, 500);
  assert.equal(card.contextText.length, 1200);
  assert.equal(card.sourceTitle.length, 300);
  assert.equal(card.sourceUrl.length, 2048);
});

test("refuses new captures after the library card limit", async () => {
  const initialCards = Array.from({ length: 5000 }, (_, index) => ({
    id: `card-${index}`,
    selectedText: `Phrase ${index}`,
    sourceUrl: "",
    tags: []
  }));
  const { localStorage, runtimeMessageHandler } = loadBackground({
    initialCards,
    injectedResult: {
      selectedText: "One phrase too many",
      contextText: "",
      sourceTitle: "Example",
      sourceUrl: "https://example.com"
    }
  });

  const result = await captureFromPopup(runtimeMessageHandler);

  assert.equal(result.ok, false);
  assert.equal(result.error, "Phraselet can store up to 5000 phrases.");
  assert.equal(localStorage["phraselet.cards"].length, 5000);
});

test("restricts local extension storage to trusted contexts", async () => {
  const { storageAccessLevels } = loadBackground();
  await new Promise(setImmediate);

  assert.deepEqual(
    structuredClone(storageAccessLevels),
    [{ accessLevel: "TRUSTED_CONTEXTS" }]
  );
});

test("migrates saved Pausemark data and legacy learning states", async () => {
  const legacyCards = [{ id: "legacy", selectedText: "Keep this", status: "known", tags: [] }];
  const legacySettings = { apiKey: "legacy-key", afterSave: "open_popup" };
  const { localStorage } = loadBackground({ legacyCards, legacySettings });

  for (let attempts = 0; attempts < 10 && !localStorage["phraselet.cards"]; attempts += 1) {
    await new Promise(setImmediate);
  }

  assert.equal(localStorage["phraselet.cards"][0].status, "archived");
  assert.deepEqual(localStorage["phraselet.settings"], legacySettings);
  assert.equal(localStorage["pausemark.cards"], undefined);
  assert.equal(localStorage["pausemark.settings"], undefined);
});

test("opens onboarding on first install but not on extension updates", async () => {
  const { createdTabs, installedHandler } = loadBackground();

  installedHandler({ reason: "update" });
  installedHandler({ reason: "install" });
  await new Promise(setImmediate);

  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].url, "chrome-extension://phraselet/onboarding.html");
});

test("applies bulk tagging and archive changes in one storage mutation", async () => {
  const initialCards = [
    { id: "one", selectedText: "First", status: "learning", tags: ["work"] },
    { id: "two", selectedText: "Second", status: "learning", tags: [] },
    { id: "three", selectedText: "Third", status: "learning", tags: [] }
  ];
  const { localStorage, runtimeMessageHandler } = loadBackground({ initialCards });

  const tagResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "add_tag",
    cardIds: ["one", "two"],
    tag: "Review"
  });
  assert.equal(tagResult.ok, true);
  assert.equal(tagResult.changed, 2);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"][0].tags), ["work", "Review"]);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"][1].tags), ["Review"]);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"][2].tags), []);

  const removeTagResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "remove_tag",
    cardIds: ["one"],
    tag: "review"
  });
  assert.equal(removeTagResult.ok, true);
  assert.equal(removeTagResult.changed, 1);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"][0].tags), ["work"]);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"][1].tags), ["Review"]);

  const archiveResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "archive",
    cardIds: ["one", "two"]
  });
  assert.equal(archiveResult.ok, true);
  assert.equal(archiveResult.changed, 2);
  assert.equal(localStorage["phraselet.cards"][0].status, "archived");
  assert.equal(localStorage["phraselet.cards"][1].status, "archived");
  assert.equal(localStorage["phraselet.cards"][2].status, "current");

  const restoreResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "restore",
    cardIds: ["two"]
  });
  assert.equal(restoreResult.ok, true);
  assert.equal(restoreResult.changed, 1);
  assert.equal(localStorage["phraselet.cards"][1].status, "current");
});

test("bulk delete removes only selected cards", async () => {
  const initialCards = [
    { id: "one", selectedText: "First", tags: [] },
    { id: "two", selectedText: "Second", tags: [] },
    { id: "three", selectedText: "Third", tags: [] }
  ];
  const { localStorage, runtimeMessageHandler } = loadBackground({ initialCards });

  const result = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "delete",
    cardIds: ["one", "three"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, 2);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"], (card) => card.id), ["two"]);
});

test("bulk tags survive an AI explanation that completes later", async () => {
  let resolveFetch;
  const fetchStarted = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const initialCards = [{
    id: "one",
    selectedText: "A phrase",
    contextText: "A phrase in context.",
    status: "learning",
    tags: [],
    ai: { status: "pending", examples: [], relatedTerms: [] }
  }];
  const { localStorage, runtimeMessageHandler } = loadBackground({
    initialCards,
    initialSettings: { apiKey: "test-key", model: "test-model" },
    fetchImplementation: () => fetchStarted
  });

  const enrichment = sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_ENRICH_CARD",
    cardId: "one"
  });
  await new Promise(setImmediate);

  await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "add_tag",
    cardIds: ["one"],
    tag: "Keep me"
  });

  resolveFetch({
    ok: true,
    async json() {
      return {
        output_text: JSON.stringify({
          summary: "A summary.",
          contextMeaning: "A contextual meaning.",
          examples: ["An example."],
          relatedTerms: ["A related term."]
        })
      };
    }
  });
  const result = await enrichment;

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(localStorage["phraselet.cards"][0].tags), ["Keep me"]);
  assert.equal(localStorage["phraselet.cards"][0].ai.status, "enriched");
});

test("sends bounded, non-stored structured OpenAI requests", async () => {
  let capturedOptions;
  const initialCards = [{
    id: "one",
    selectedText: "A phrase",
    contextText: "A phrase in context.",
    sourceTitle: "A source",
    sourceUrl: "https://example.com",
    status: "learning",
    tags: [],
    ai: { status: "pending", examples: [], relatedTerms: [] }
  }];
  const { runtimeMessageHandler } = loadBackground({
    initialCards,
    initialSettings: { apiKey: "test-key", model: "test-model" },
    fetchImplementation: async (_url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        async json() {
          return {
            output: [{
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  summary: "A summary.",
                  contextMeaning: "A contextual meaning.",
                  examples: ["An example."],
                  relatedTerms: ["A related term."]
                })
              }]
            }]
          };
        }
      };
    }
  });

  const result = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_ENRICH_CARD",
    cardId: "one"
  });
  const request = JSON.parse(capturedOptions.body);

  assert.equal(result.ok, true);
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 600);
  assert.equal(request.text.format.strict, true);
  assert.ok(capturedOptions.signal instanceof AbortSignal);
  const userInput = JSON.parse(request.input[1].content);
  assert.equal(userInput.sourceHost, "example.com");
  assert.equal(userInput.sourceUrl, undefined);
});

test("does not expose OpenAI error response bodies", async () => {
  const initialCards = [{
    id: "one",
    selectedText: "A phrase",
    contextText: "",
    status: "learning",
    tags: [],
    ai: { status: "pending", examples: [], relatedTerms: [] }
  }];
  const { runtimeMessageHandler } = loadBackground({
    initialCards,
    initialSettings: { apiKey: "bad-key" },
    fetchImplementation: async () => ({
      ok: false,
      status: 401,
      headers: { get: () => "request-123" },
      async text() {
        return "sensitive upstream response";
      }
    })
  });

  const result = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_ENRICH_CARD",
    cardId: "one"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /rejected the API key/);
  assert.match(result.error, /request-123/);
  assert.doesNotMatch(result.error, /sensitive upstream response/);
});

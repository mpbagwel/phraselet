const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(projectRoot, "src/background.js"), "utf8");
const openAiSource = fs.readFileSync(path.join(projectRoot, "src/enrichment/openai.js"), "utf8");

function loadBackground({
  fetchImplementation = fetch,
  injectedResult = null,
  injectionError = null,
  initialCards = null,
  initialSettings = null,
  legacyCards = null,
  legacySettings = null,
  aiEnrichment = true
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
      return Object.fromEntries(requestedKeys.map((key) => [key, state[key]]));
    },
    async set(values) {
      Object.assign(state, values);
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
  const runnableBackgroundSource = backgroundSource.replace(
    'import { FEATURES, loadEnrichmentProvider } from "./features.js";',
    `const FEATURES = Object.freeze({ aiEnrichment: ${aiEnrichment} });\nconst loadEnrichmentProvider = async () => FEATURES.aiEnrichment ? ({ requestExplanation: globalThis.__requestExplanation }) : null;`
  );
  vm.runInContext(providerSource, context, { filename: "src/enrichment/openai.js" });
  vm.runInContext(runnableBackgroundSource, context, { filename: "src/background.js" });

  return {
    badgeTexts,
    chrome,
    commandHandler,
    createdTabs,
    installedHandler,
    localStorage,
    runtimeMessageHandler,
    storageAccessLevels
  };
}

function captureFromPopup(runtimeMessageHandler) {
  return sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_SAVE_ACTIVE_SELECTION"
  });
}

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

test("migrates saved Pausemark data to Phraselet storage keys", async () => {
  const legacyCards = [{ id: "legacy", selectedText: "Keep this", tags: [] }];
  const legacySettings = { apiKey: "legacy-key", afterSave: "open_popup" };
  const { localStorage } = loadBackground({ legacyCards, legacySettings });

  for (let attempts = 0; attempts < 10 && !localStorage["phraselet.cards"]; attempts += 1) {
    await new Promise(setImmediate);
  }

  assert.deepEqual(localStorage["phraselet.cards"], legacyCards);
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

test("applies bulk tagging and status changes in one storage mutation", async () => {
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

  const statusResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PHRASELET_BULK_UPDATE_CARDS",
    operation: "mark_known",
    cardIds: ["one", "two"]
  });
  assert.equal(statusResult.ok, true);
  assert.equal(statusResult.changed, 2);
  assert.equal(localStorage["phraselet.cards"][0].status, "known");
  assert.equal(localStorage["phraselet.cards"][1].status, "known");
  assert.equal(localStorage["phraselet.cards"][2].status, "learning");
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

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(projectRoot, "src/background.js"), "utf8");

function loadBackground({
  fetchImplementation = fetch,
  injectedResult = null,
  injectionError = null,
  initialCards = null,
  initialSettings = null
} = {}) {
  const localStorage = initialCards
    ? { "pausemark.cards": structuredClone(initialCards) }
    : {};
  if (initialSettings) {
    localStorage["pausemark.settings"] = structuredClone(initialSettings);
  }
  const sessionStorage = {};
  const badgeTexts = [];
  const createdTabs = [];
  let commandHandler;
  let installedHandler;
  let runtimeMessageHandler;

  const storageArea = (state) => ({
    async get(key) {
      return { [key]: state[key] };
    },
    async set(values) {
      Object.assign(state, values);
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
        return `chrome-extension://pausemark/${pathname}`;
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

  vm.runInNewContext(backgroundSource, {
    chrome,
    console,
    crypto: webcrypto,
    fetch: fetchImplementation,
    setTimeout,
    URL
  }, { filename: "src/background.js" });

  return {
    badgeTexts,
    chrome,
    commandHandler,
    createdTabs,
    installedHandler,
    localStorage,
    runtimeMessageHandler
  };
}

function captureFromPopup(runtimeMessageHandler) {
  return sendRuntimeMessage(runtimeMessageHandler, {
    type: "PAUSEMARK_SAVE_ACTIVE_SELECTION"
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
  for (let attempts = 0; attempts < 10 && !localStorage["pausemark.cards"]; attempts += 1) {
    await new Promise(setImmediate);
  }

  assert.equal(localStorage["pausemark.cards"].length, 1);
  assert.equal(localStorage["pausemark.cards"][0].selectedText, selectedText);
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
  assert.equal(localStorage["pausemark.cards"], undefined);
});

test("declares the scripting permission needed by the fallback", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("scripting"));
});

test("opens onboarding on first install but not on extension updates", async () => {
  const { createdTabs, installedHandler } = loadBackground();

  installedHandler({ reason: "update" });
  installedHandler({ reason: "install" });
  await new Promise(setImmediate);

  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].url, "chrome-extension://pausemark/onboarding.html");
});

test("applies bulk tagging and status changes in one storage mutation", async () => {
  const initialCards = [
    { id: "one", selectedText: "First", status: "learning", tags: ["work"] },
    { id: "two", selectedText: "Second", status: "learning", tags: [] },
    { id: "three", selectedText: "Third", status: "learning", tags: [] }
  ];
  const { localStorage, runtimeMessageHandler } = loadBackground({ initialCards });

  const tagResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PAUSEMARK_BULK_UPDATE_CARDS",
    operation: "add_tag",
    cardIds: ["one", "two"],
    tag: "Review"
  });
  assert.equal(tagResult.ok, true);
  assert.equal(tagResult.changed, 2);
  assert.deepEqual(Array.from(localStorage["pausemark.cards"][0].tags), ["work", "Review"]);
  assert.deepEqual(Array.from(localStorage["pausemark.cards"][1].tags), ["Review"]);
  assert.deepEqual(Array.from(localStorage["pausemark.cards"][2].tags), []);

  const removeTagResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PAUSEMARK_BULK_UPDATE_CARDS",
    operation: "remove_tag",
    cardIds: ["one"],
    tag: "review"
  });
  assert.equal(removeTagResult.ok, true);
  assert.equal(removeTagResult.changed, 1);
  assert.deepEqual(Array.from(localStorage["pausemark.cards"][0].tags), ["work"]);
  assert.deepEqual(Array.from(localStorage["pausemark.cards"][1].tags), ["Review"]);

  const statusResult = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PAUSEMARK_BULK_UPDATE_CARDS",
    operation: "mark_known",
    cardIds: ["one", "two"]
  });
  assert.equal(statusResult.ok, true);
  assert.equal(statusResult.changed, 2);
  assert.equal(localStorage["pausemark.cards"][0].status, "known");
  assert.equal(localStorage["pausemark.cards"][1].status, "known");
  assert.equal(localStorage["pausemark.cards"][2].status, "learning");
});

test("bulk delete removes only selected cards", async () => {
  const initialCards = [
    { id: "one", selectedText: "First", tags: [] },
    { id: "two", selectedText: "Second", tags: [] },
    { id: "three", selectedText: "Third", tags: [] }
  ];
  const { localStorage, runtimeMessageHandler } = loadBackground({ initialCards });

  const result = await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PAUSEMARK_BULK_UPDATE_CARDS",
    operation: "delete",
    cardIds: ["one", "three"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, 2);
  assert.deepEqual(Array.from(localStorage["pausemark.cards"], (card) => card.id), ["two"]);
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
    type: "PAUSEMARK_ENRICH_CARD",
    cardId: "one"
  });
  await new Promise(setImmediate);

  await sendRuntimeMessage(runtimeMessageHandler, {
    type: "PAUSEMARK_BULK_UPDATE_CARDS",
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
  assert.deepEqual(Array.from(localStorage["pausemark.cards"][0].tags), ["Keep me"]);
  assert.equal(localStorage["pausemark.cards"][0].ai.status, "enriched");
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(projectRoot, "src/background.js"), "utf8");

function loadBackground({ injectedResult = null, injectionError = null } = {}) {
  const localStorage = {};
  const sessionStorage = {};
  const badgeTexts = [];
  let commandHandler;
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
      onInstalled: { addListener() {} },
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
    fetch,
    setTimeout,
    URL
  }, { filename: "src/background.js" });

  return { badgeTexts, chrome, commandHandler, localStorage, runtimeMessageHandler };
}

function captureFromPopup(runtimeMessageHandler) {
  return new Promise((resolve) => {
    const keepChannelOpen = runtimeMessageHandler(
      { type: "PAUSEMARK_SAVE_ACTIVE_SELECTION" },
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

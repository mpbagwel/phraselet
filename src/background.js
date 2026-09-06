const MENU_ID = "pausemark-save-selection";
const CARDS_KEY = "pausemark.cards";
const SETTINGS_KEY = "pausemark.settings";
const SELECTIONS_KEY = "pausemark.selections";
const SELECTION_TTL_MS = 2 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save to Pausemark",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  saveSelectionWithFeedback(tab.id, {
    selectedText: info.selectionText ?? "",
    sourceTitle: tab.title ?? "",
    sourceUrl: tab.url ?? "",
    windowId: tab.windowId
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "save-selected-snippet") {
    return;
  }

  handleShortcutCapture(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PAUSEMARK_SELECTION_CHANGED") {
    recordSelectionPayload(message.payload, sender).catch(() => undefined);
    return false;
  }

  if (message?.type === "PAUSEMARK_SAVE_ACTIVE_SELECTION") {
    handlePopupCapture(sendResponse);
    return true;
  }

  if (message?.type === "PAUSEMARK_ENRICH_CARD") {
    enrichExistingCard(message.cardId).then(sendResponse);
    return true;
  }

  return false;
});

async function handlePopupCapture(sendResponse) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    sendResponse({ ok: false, error: "No active tab found." });
    return;
  }

  const result = await saveSelectionFromTab(tab.id, {
    sourceTitle: tab.title ?? "",
    sourceUrl: tab.url ?? ""
  });
  sendResponse(result);
}

async function handleShortcutCapture(commandTab) {
  const tab = commandTab?.id
    ? commandTab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  if (!tab?.id) {
    await setBadge("!");
    return;
  }

  await saveSelectionWithFeedback(tab.id, {
    sourceTitle: tab.title ?? "",
    sourceUrl: tab.url ?? "",
    windowId: tab.windowId
  });
}

async function saveSelectionWithFeedback(tabId, fallback) {
  const result = await saveSelectionFromTab(tabId, fallback);

  if (!result.ok) {
    await showCaptureToast(tabId, result);
    await setBadge("!");
    return result;
  }

  const settings = await getSettings();
  const openedPopup = settings.afterSave === "open_popup"
    && await openPausemarkPopup(fallback.windowId);

  if (!openedPopup) {
    await showCaptureToast(tabId, result);
  }

  return result;
}

async function openPausemarkPopup(windowId) {
  if (typeof chrome.action.openPopup !== "function") {
    return false;
  }

  try {
    if (Number.isInteger(windowId)) {
      await chrome.action.openPopup({ windowId });
    } else {
      await chrome.action.openPopup();
    }
    return true;
  } catch {
    return false;
  }
}

async function saveSelectionFromTab(tabId, fallback) {
  const payload = await getSelectionPayload(tabId, fallback);
  const selectedText = cleanText(payload.selectedText);

  if (!selectedText) {
    return { ok: false, error: "Select a word or phrase first." };
  }

  const card = {
    id: crypto.randomUUID(),
    selectedText,
    contextText: cleanText(payload.contextText),
    sourceTitle: payload.sourceTitle || fallback.sourceTitle || "",
    sourceUrl: payload.sourceUrl || fallback.sourceUrl || "",
    createdAt: new Date().toISOString(),
    status: "learning",
    note: "",
    tags: [],
    ai: {
      status: "pending",
      summary: "",
      contextMeaning: "",
      examples: [],
      relatedTerms: [],
      error: ""
    }
  };

  await upsertCard(card);
  await setBadge("1");
  enrichExistingCard(card.id).catch(() => undefined);

  return { ok: true, cardId: card.id, selectedText: truncateText(selectedText, 80) };
}

async function showCaptureToast(tabId, result) {
  const message = result.ok
    ? `Saved "${result.selectedText}"`
    : result.error;

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "PAUSEMARK_SHOW_TOAST",
      tone: result.ok ? "success" : "error",
      message
    });
  } catch {
    // Some browser and extension pages cannot receive content-script messages.
  }
}

async function getSelectionPayload(tabId, fallback) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "PAUSEMARK_GET_SELECTION"
    });

    const selectedText = cleanText(response?.selectedText)
      ? response.selectedText
      : fallback.selectedText;
    const payload = {
      ...fallback,
      ...response,
      selectedText
    };

    if (cleanText(payload.selectedText)) {
      return payload;
    }
  } catch {
    // Content scripts are unavailable on browser pages and some protected URLs.
  }

  return getRecentSelectionPayload(tabId, fallback);
}

async function recordSelectionPayload(payload, sender) {
  const tabId = sender.tab?.id;
  const selectedText = cleanText(payload?.selectedText);

  if (!tabId || !selectedText) {
    return;
  }

  const selections = await getRecentSelections();
  selections[String(tabId)] = {
    selectedText,
    contextText: cleanText(payload.contextText),
    sourceTitle: cleanText(payload.sourceTitle || sender.tab?.title),
    sourceUrl: cleanText(payload.sourceUrl || sender.tab?.url),
    tabUrl: cleanText(sender.tab?.url),
    savedAt: Date.now()
  };

  await chrome.storage.session.set({ [SELECTIONS_KEY]: selections });
}

async function getRecentSelectionPayload(tabId, fallback) {
  const selections = await getRecentSelections();
  const payload = selections[String(tabId)];

  if (!payload || Date.now() - payload.savedAt > SELECTION_TTL_MS) {
    return fallback;
  }

  const payloadTabUrl = payload.tabUrl || payload.sourceUrl;
  if (fallback.sourceUrl && payloadTabUrl && payloadTabUrl !== fallback.sourceUrl) {
    return fallback;
  }

  return {
    ...fallback,
    ...payload
  };
}

async function getRecentSelections() {
  const result = await chrome.storage.session.get(SELECTIONS_KEY);
  return result[SELECTIONS_KEY] && typeof result[SELECTIONS_KEY] === "object"
    ? result[SELECTIONS_KEY]
    : {};
}

async function enrichExistingCard(cardId) {
  const cards = await getCards();
  const card = cards.find((candidate) => candidate.id === cardId);

  if (!card) {
    return { ok: false, error: "Card not found." };
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    const updated = {
      ...card,
      ai: {
        ...card.ai,
        status: "needs_api_key",
        summary: fallbackDefinition(card.selectedText),
        contextMeaning: card.contextText
          ? "Add an OpenAI API key in Options to generate a context-specific explanation."
          : "",
        error: ""
      }
    };
    await upsertCard(updated);
    return { ok: true, card: updated };
  }

  await upsertCard({
    ...card,
    ai: {
      ...card.ai,
      status: "pending",
      error: ""
    }
  });

  try {
    const explanation = await requestExplanation(card, settings);
    const updated = {
      ...card,
      ai: {
        status: "enriched",
        summary: explanation.summary,
        contextMeaning: explanation.contextMeaning,
        examples: explanation.examples,
        relatedTerms: explanation.relatedTerms,
        error: ""
      }
    };
    await upsertCard(updated);
    return { ok: true, card: updated };
  } catch (error) {
    const updated = {
      ...card,
      ai: {
        ...card.ai,
        status: "error",
        error: error instanceof Error ? error.message : "AI enrichment failed."
      }
    };
    await upsertCard(updated);
    return { ok: false, card: updated, error: updated.ai.error };
  }
}

async function requestExplanation(card, settings) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: "You explain saved words and short phrases for a curious reader. Be concise, accurate, and context-aware."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Explain this saved word or phrase.",
            phrase: card.selectedText,
            surroundingContext: card.contextText,
            sourceTitle: card.sourceTitle,
            sourceUrl: card.sourceUrl,
            responseShape: {
              summary: "One or two plain-language sentences.",
              contextMeaning: "Meaning in the provided context, if context exists.",
              examples: ["Two short example uses."],
              relatedTerms: ["Three related words, phrases, or concepts."]
            }
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pausemark_explanation",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              contextMeaning: { type: "string" },
              examples: {
                type: "array",
                items: { type: "string" },
                maxItems: 3
              },
              relatedTerms: {
                type: "array",
                items: { type: "string" },
                maxItems: 5
              }
            },
            required: ["summary", "contextMeaning", "examples", "relatedTerms"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 180)}`);
  }

  const data = await response.json();
  const text = data.output_text || data.output?.[0]?.content?.[0]?.text;

  if (!text) {
    throw new Error("OpenAI returned an empty explanation.");
  }

  return normalizeExplanation(JSON.parse(text));
}

function normalizeExplanation(explanation) {
  return {
    summary: cleanText(explanation.summary),
    contextMeaning: cleanText(explanation.contextMeaning),
    examples: Array.isArray(explanation.examples)
      ? explanation.examples.map(cleanText).filter(Boolean).slice(0, 3)
      : [],
    relatedTerms: Array.isArray(explanation.relatedTerms)
      ? explanation.relatedTerms.map(cleanText).filter(Boolean).slice(0, 5)
      : []
  };
}

async function getCards() {
  const result = await chrome.storage.local.get(CARDS_KEY);
  return Array.isArray(result[CARDS_KEY]) ? result[CARDS_KEY] : [];
}

async function upsertCard(card) {
  const cards = await getCards();
  const nextCards = [
    card,
    ...cards.filter((candidate) => candidate.id !== card.id)
  ];
  await chrome.storage.local.set({ [CARDS_KEY]: nextCards });
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    apiKey: "",
    model: "gpt-4.1-mini",
    afterSave: "confirmation",
    ...result[SETTINGS_KEY]
  };
}

async function setBadge(text) {
  await chrome.action.setBadgeBackgroundColor({ color: "#255f85" });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = cleanText(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function fallbackDefinition(phrase) {
  return `Saved "${phrase}". AI enrichment is ready once an API key is configured.`;
}

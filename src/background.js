const MENU_ID = "pausemark-save-selection";
const CARDS_KEY = "pausemark.cards";
const SETTINGS_KEY = "pausemark.settings";

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

  saveSelectionFromTab(tab.id, {
    selectedText: info.selectionText ?? "",
    sourceTitle: tab.title ?? "",
    sourceUrl: tab.url ?? ""
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "save-selected-snippet") {
    return;
  }

  handleShortcutCapture(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  const result = await saveSelectionFromTab(tab.id, {
    sourceTitle: tab.title ?? "",
    sourceUrl: tab.url ?? ""
  });

  if (!result.ok) {
    await setBadge("!");
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

  return { ok: true, cardId: card.id };
}

async function getSelectionPayload(tabId, fallback) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "PAUSEMARK_GET_SELECTION"
    });

    return {
      ...fallback,
      ...response
    };
  } catch {
    return fallback;
  }
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

function fallbackDefinition(phrase) {
  return `Saved "${phrase}". AI enrichment is ready once an API key is configured.`;
}

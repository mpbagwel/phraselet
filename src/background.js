const MENU_ID = "pausemark-save-selection";
const CARDS_KEY = "pausemark.cards";
const SETTINGS_KEY = "pausemark.settings";
const SELECTIONS_KEY = "pausemark.selections";
const SELECTION_TTL_MS = 2 * 60 * 1000;
let cardsMutationQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save to Pausemark",
    contexts: ["selection"]
  });

  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html")
    }).catch(() => undefined);
  }
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
    respondToMessage(handlePopupCapture(), sendResponse);
    return true;
  }

  if (message?.type === "PAUSEMARK_ENRICH_CARD") {
    respondToMessage(enrichExistingCard(message.cardId), sendResponse);
    return true;
  }

  if (message?.type === "PAUSEMARK_BULK_UPDATE_CARDS") {
    respondToMessage(bulkUpdateCards(message), sendResponse);
    return true;
  }

  return false;
});

function respondToMessage(operation, sendResponse) {
  operation
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Pausemark could not complete that action."
    }));
}

async function handlePopupCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab found." };
  }

  return saveSelectionFromTab(tab.id, {
    sourceTitle: tab.title ?? "",
    sourceUrl: tab.url ?? ""
  });
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

  const sourceTitle = payload.sourceTitle || fallback.sourceTitle || "";
  const sourceUrl = payload.sourceUrl || fallback.sourceUrl || "";
  const cards = await getCards();
  const existingCard = cards.find((card) => (
    cardIdentity(card.selectedText, card.sourceUrl) === cardIdentity(selectedText, sourceUrl)
  ));

  if (existingCard) {
    await upsertCard({
      ...existingCard,
      contextText: cleanText(payload.contextText) || existingCard.contextText || "",
      sourceTitle: sourceTitle || existingCard.sourceTitle || "",
      sourceUrl: sourceUrl || existingCard.sourceUrl || ""
    });
    await setBadge("1");

    return {
      ok: true,
      duplicate: true,
      cardId: existingCard.id,
      selectedText: truncateText(selectedText, 80)
    };
  }

  const card = {
    id: crypto.randomUUID(),
    selectedText,
    contextText: cleanText(payload.contextText),
    sourceTitle,
    sourceUrl,
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
    ? `${result.duplicate ? "Already saved" : "Saved"} "${result.selectedText}"`
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

  const injectedPayload = await getInjectedSelectionPayload(tabId);
  if (cleanText(injectedPayload?.selectedText)) {
    return {
      ...fallback,
      ...injectedPayload
    };
  }

  return getRecentSelectionPayload(tabId, fallback);
}

async function getInjectedSelectionPayload(tabId) {
  if (!chrome.scripting?.executeScript) {
    return null;
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readSelectionFromPage
    });
    return injection?.result || null;
  } catch {
    // Script injection is unavailable on browser pages and other protected URLs.
    return null;
  }
}

function readSelectionFromPage() {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const element = document.activeElement;
  const isTextControl = element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement && /^(search|tel|text|url)$/i.test(element.type);

  if (isTextControl) {
    try {
      const { selectionStart, selectionEnd } = element;
      if (typeof selectionStart === "number" && typeof selectionEnd === "number" && selectionStart !== selectionEnd) {
        return {
          selectedText: normalize(element.value.slice(selectionStart, selectionEnd)),
          contextText: normalize(element.value),
          sourceTitle: document.title,
          sourceUrl: location.href
        };
      }
    } catch {
      // Some input types do not expose their selection range.
    }
  }

  const selection = window.getSelection();
  const selectedText = normalize(selection?.toString());
  let contextText = "";

  if (selectedText && selection?.rangeCount) {
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const selectionElement = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const block = selectionElement?.closest("p, li, blockquote, article, section, main, div");
    contextText = normalize(block?.innerText || block?.textContent).slice(0, 900);
  }

  return {
    selectedText,
    contextText,
    sourceTitle: document.title,
    sourceUrl: location.href
  };
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
    const updated = await patchCard(cardId, (currentCard) => ({
      ...currentCard,
      ai: {
        ...currentCard.ai,
        status: "needs_api_key",
        summary: fallbackDefinition(currentCard.selectedText),
        contextMeaning: currentCard.contextText
          ? "Add an OpenAI API key in Options to generate a context-specific explanation."
          : "",
        error: ""
      }
    }));
    return { ok: true, card: updated };
  }

  await patchCard(cardId, (currentCard) => ({
    ...currentCard,
    ai: {
      ...currentCard.ai,
      status: "pending",
      error: ""
    }
  }));

  try {
    const explanation = await requestExplanation(card, settings);
    const updated = await patchCard(cardId, (currentCard) => {
      if (!hasSameExplanationInput(currentCard, card)) {
        return null;
      }

      return {
        ...currentCard,
        ai: {
          status: "enriched",
          summary: explanation.summary,
          contextMeaning: explanation.contextMeaning,
          examples: explanation.examples,
          relatedTerms: explanation.relatedTerms,
          error: ""
        }
      };
    });

    if (!updated) {
      return { ok: false, error: "The phrase changed before its explanation finished." };
    }
    return { ok: true, card: updated };
  } catch (error) {
    const updated = await patchCard(cardId, (currentCard) => {
      if (!hasSameExplanationInput(currentCard, card)) {
        return null;
      }

      return {
        ...currentCard,
        ai: {
          ...currentCard.ai,
          status: "error",
          error: error instanceof Error ? error.message : "AI enrichment failed."
        }
      };
    });
    const errorMessage = updated?.ai?.error
      || (error instanceof Error ? error.message : "AI enrichment failed.");
    return { ok: false, card: updated, error: errorMessage };
  }
}

function hasSameExplanationInput(left, right) {
  return cleanText(left?.selectedText) === cleanText(right?.selectedText)
    && cleanText(left?.contextText) === cleanText(right?.contextText);
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

async function bulkUpdateCards(message) {
  const cardIds = Array.isArray(message.cardIds)
    ? [...new Set(message.cardIds.map(cleanText).filter(Boolean))]
    : [];
  const operation = message.operation;

  if (!cardIds.length) {
    return { ok: false, error: "Select at least one phrase." };
  }

  if (!["add_tag", "remove_tag", "mark_known", "mark_learning", "delete"].includes(operation)) {
    return { ok: false, error: "That bulk action is not supported." };
  }

  const tag = cleanText(message.tag).slice(0, 40);
  if (["add_tag", "remove_tag"].includes(operation) && !tag) {
    return { ok: false, error: "Enter a tag name." };
  }

  return mutateCards((cards) => {
    const selectedIds = new Set(cardIds);
    let changed = 0;
    let nextCards;

    if (operation === "delete") {
      nextCards = cards.filter((card) => {
        const shouldDelete = selectedIds.has(card.id);
        if (shouldDelete) {
          changed += 1;
        }
        return !shouldDelete;
      });
    } else {
      nextCards = cards.map((card) => {
        if (!selectedIds.has(card.id)) {
          return card;
        }

        if (operation === "mark_known" || operation === "mark_learning") {
          const status = operation === "mark_known" ? "known" : "learning";
          if (card.status === status) {
            return card;
          }
          changed += 1;
          return { ...card, status };
        }

        const tags = normalizeCardTags(card.tags);
        const tagKey = tag.toLowerCase();
        const hasTag = tags.some((candidate) => candidate.toLowerCase() === tagKey);

        if (operation === "add_tag") {
          if (hasTag || tags.length >= 12) {
            return card;
          }
          changed += 1;
          return { ...card, tags: [...tags, tag] };
        }

        if (!hasTag) {
          return card;
        }
        changed += 1;
        return {
          ...card,
          tags: tags.filter((candidate) => candidate.toLowerCase() !== tagKey)
        };
      });
    }

    return {
      cards: nextCards,
      value: { ok: true, changed, requested: cardIds.length }
    };
  });
}

function normalizeCardTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set();
  return tags.map((tag) => cleanText(tag).slice(0, 40)).filter((tag) => {
    const key = tag.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 12);
}

async function getCards() {
  const result = await chrome.storage.local.get(CARDS_KEY);
  return Array.isArray(result[CARDS_KEY]) ? result[CARDS_KEY] : [];
}

async function upsertCard(card) {
  return mutateCards((cards) => ({
    cards: [
      card,
      ...cards.filter((candidate) => candidate.id !== card.id)
    ],
    value: card
  }));
}

function patchCard(cardId, updater) {
  return mutateCards((cards) => {
    const cardIndex = cards.findIndex((card) => card.id === cardId);
    if (cardIndex === -1) {
      return { cards, value: null };
    }

    const updatedCard = updater(cards[cardIndex]);
    if (!updatedCard) {
      return { cards, value: null };
    }

    const nextCards = [...cards];
    nextCards[cardIndex] = updatedCard;
    return { cards: nextCards, value: updatedCard };
  });
}

function mutateCards(mutator) {
  const mutation = cardsMutationQueue.then(async () => {
    const cards = await getCards();
    const { cards: nextCards, value } = mutator(cards);
    await chrome.storage.local.set({ [CARDS_KEY]: nextCards });
    return value;
  });

  cardsMutationQueue = mutation.catch(() => undefined);
  return mutation;
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

function cardIdentity(selectedText, sourceUrl) {
  return `${cleanText(selectedText).toLowerCase()}\n${canonicalizeUrl(sourceUrl)}`;
}

function canonicalizeUrl(value) {
  const sourceUrl = cleanText(value);

  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function fallbackDefinition(phrase) {
  return `Saved "${phrase}". AI enrichment is ready once an API key is configured.`;
}

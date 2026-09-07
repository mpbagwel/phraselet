const MENU_ID = "pausemark-save-selection";
const CARDS_KEY = "pausemark.cards";
const SETTINGS_KEY = "pausemark.settings";
const MAX_PHRASE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 1200;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
const MAX_AI_TEXT_LENGTH = 1200;
const MAX_AI_ITEM_LENGTH = 500;
const MAX_LIBRARY_CARDS = 5000;
const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
const OPENAI_TIMEOUT_MS = 30 * 1000;
let cardsMutationQueue = Promise.resolve();

chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
}).catch(() => undefined);

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
    windowId: tab.windowId,
    frameId: info.frameId
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
    await showCaptureToast(tabId, result, fallback.frameId);
    await setBadge("!");
    return result;
  }

  const settings = await getSettings();
  const openedPopup = settings.afterSave === "open_popup"
    && await openPausemarkPopup(fallback.windowId);

  if (!openedPopup) {
    await showCaptureToast(tabId, result, fallback.frameId);
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
  const selectedText = cleanText(payload.selectedText).slice(0, MAX_PHRASE_LENGTH);

  if (!selectedText) {
    return { ok: false, error: "Select a word or phrase first." };
  }

  const sourceTitle = cleanText(payload.sourceTitle || fallback.sourceTitle).slice(0, MAX_TITLE_LENGTH);
  const sourceUrl = cleanText(payload.sourceUrl || fallback.sourceUrl).slice(0, MAX_URL_LENGTH);
  const contextText = cleanText(payload.contextText).slice(0, MAX_CONTEXT_LENGTH);
  const cards = await getCards();
  const existingCard = cards.find((card) => (
    cardIdentity(card.selectedText, card.sourceUrl) === cardIdentity(selectedText, sourceUrl)
  ));

  if (existingCard) {
    await upsertCard({
      ...existingCard,
      contextText: contextText || existingCard.contextText || "",
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
    contextText,
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

async function showCaptureToast(tabId, result, frameId) {
  const message = result.ok
    ? `${result.duplicate ? "Already saved" : "Saved"} "${result.selectedText}"`
    : result.error;

  try {
    const target = Number.isInteger(frameId)
      ? { tabId, frameIds: [frameId] }
      : { tabId };
    await chrome.scripting.executeScript({
      target,
      func: displayCaptureToast,
      args: [message, result.ok ? "success" : "error"]
    });
  } catch {
    // Some browser and extension pages do not allow script injection.
  }
}

async function getSelectionPayload(tabId, fallback) {
  const injectedPayload = await getInjectedSelectionPayload(tabId, fallback.frameId);
  if (cleanText(injectedPayload?.selectedText)) {
    return {
      ...fallback,
      ...injectedPayload,
      selectedText: cleanText(fallback.selectedText) || injectedPayload.selectedText
    };
  }

  return fallback;
}

async function getInjectedSelectionPayload(tabId, frameId) {
  if (!chrome.scripting?.executeScript) {
    return null;
  }

  try {
    const target = Number.isInteger(frameId)
      ? { tabId, frameIds: [frameId] }
      : { tabId, allFrames: true };
    const injections = await chrome.scripting.executeScript({
      target,
      func: readSelectionFromPage
    });
    return injections
      .map((injection) => injection?.result)
      .find((payload) => cleanText(payload?.selectedText)) || null;
  } catch {
    // Script injection is unavailable on browser pages and other protected URLs.
    return null;
  }
}

function readSelectionFromPage() {
  const normalize = (value, maxLength) => String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  const element = document.activeElement;
  const isTextControl = element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement && /^(search|tel|text|url)$/i.test(element.type);

  if (isTextControl) {
    try {
      const { selectionStart, selectionEnd } = element;
      if (typeof selectionStart === "number" && typeof selectionEnd === "number" && selectionStart !== selectionEnd) {
        const contextStart = Math.max(0, selectionStart - 600);
        const contextEnd = Math.min(element.value.length, selectionEnd + 600);
        return {
          selectedText: normalize(element.value.slice(selectionStart, selectionEnd), 500),
          contextText: normalize(element.value.slice(contextStart, contextEnd), 1200),
          sourceTitle: normalize(document.title, 300),
          sourceUrl: normalize(location.href, 2048)
        };
      }
    } catch {
      // Some input types do not expose their selection range.
    }
  }

  const selection = window.getSelection();
  const selectedText = normalize(selection?.toString(), 500);
  let contextText = "";

  if (selectedText && selection?.rangeCount) {
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const selectionElement = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const block = selectionElement?.closest("p, li, blockquote, article, section, main, div");
    contextText = selectionWindow(normalize(block?.innerText || block?.textContent, 100000), selectedText);
  }

  return {
    selectedText,
    contextText,
    sourceTitle: normalize(document.title, 300),
    sourceUrl: normalize(location.href, 2048)
  };

  function selectionWindow(text, phrase) {
    if (!text || !phrase) {
      return "";
    }
    const index = text.toLowerCase().indexOf(phrase.toLowerCase());
    if (index === -1) {
      return text.slice(0, 1200);
    }
    const start = Math.max(0, index - 500);
    const end = Math.min(text.length, index + phrase.length + 500);
    return text.slice(start, end);
  }
}

function displayCaptureToast(message, tone) {
  const hostId = "pausemark-toast-host";
  let host = document.getElementById(hostId);

  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        [data-toast] {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          max-width: min(360px, calc(100vw - 36px));
          padding: 11px 13px;
          border-radius: 8px;
          box-shadow: 0 10px 30px rgb(23 32 38 / 22%);
          color: #fff;
          font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          opacity: 0;
          overflow-wrap: anywhere;
          pointer-events: none;
          transform: translateY(8px);
          transition: opacity 150ms ease, transform 150ms ease;
        }
        [data-toast][data-tone="success"] { background: #255f85; }
        [data-toast][data-tone="error"] { background: #a43d3d; }
        [data-toast][data-visible="true"] { opacity: 1; transform: translateY(0); }
      </style>
      <div data-toast data-tone="success" data-visible="false" role="status" aria-live="polite"></div>
    `;
    document.documentElement.append(host);
  }

  const toast = host.shadowRoot.querySelector("[data-toast]");
  toast.textContent = String(message ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  toast.dataset.tone = tone === "error" ? "error" : "success";
  toast.dataset.visible = "true";

  clearTimeout(host.__pausemarkToastTimer);
  host.__pausemarkToastTimer = setTimeout(() => {
    toast.dataset.visible = "false";
  }, 2200);
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: cleanText(settings.model).slice(0, 100) || "gpt-4.1-mini",
        store: false,
        max_output_tokens: 600,
        input: [
          {
            role: "system",
            content: "You explain saved words and short phrases for a curious reader. Be concise, accurate, and context-aware."
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Explain this saved word or phrase.",
              phrase: cleanText(card.selectedText).slice(0, MAX_PHRASE_LENGTH),
              surroundingContext: cleanText(card.contextText).slice(0, MAX_CONTEXT_LENGTH),
              sourceTitle: cleanText(card.sourceTitle).slice(0, MAX_TITLE_LENGTH),
              sourceHost: sourceHost(card.sourceUrl),
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
            strict: true,
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
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OpenAI request timed out. Try again.");
    }
    throw new Error("Could not reach OpenAI. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const requestId = response.headers?.get?.("x-request-id");
    const message = openAiHttpError(response.status);
    throw new Error(requestId ? `${message} Request ID: ${requestId}.` : message);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenAI returned an unreadable response. Try again.");
  }
  if (data.status === "failed") {
    throw new Error("OpenAI could not create an explanation. Try again.");
  }
  if (data.status === "incomplete") {
    throw new Error("OpenAI returned an incomplete explanation. Try again.");
  }

  const text = extractResponseText(data);

  if (!text) {
    throw new Error("OpenAI returned an empty explanation.");
  }

  try {
    return normalizeExplanation(JSON.parse(text));
  } catch {
    throw new Error("OpenAI returned an explanation in an unexpected format. Try again.");
  }
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  return Array.isArray(data?.output)
    ? data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((part) => part?.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    : "";
}

function openAiHttpError(status) {
  if (status === 401 || status === 403) {
    return "OpenAI rejected the API key. Check it in Settings.";
  }
  if (status === 429) {
    return "OpenAI is rate-limiting requests. Wait a moment and try again.";
  }
  if (status >= 500) {
    return "OpenAI is temporarily unavailable. Try again later.";
  }
  return `OpenAI request failed (${status}).`;
}

function normalizeExplanation(explanation) {
  return {
    summary: cleanText(explanation.summary).slice(0, MAX_AI_TEXT_LENGTH),
    contextMeaning: cleanText(explanation.contextMeaning).slice(0, MAX_AI_TEXT_LENGTH),
    examples: Array.isArray(explanation.examples)
      ? explanation.examples
        .map((item) => cleanText(item).slice(0, MAX_AI_ITEM_LENGTH))
        .filter(Boolean)
        .slice(0, 3)
      : [],
    relatedTerms: Array.isArray(explanation.relatedTerms)
      ? explanation.relatedTerms
        .map((item) => cleanText(item).slice(0, MAX_AI_ITEM_LENGTH))
        .filter(Boolean)
        .slice(0, 5)
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
    assertLibraryWithinLimits(nextCards, cards);
    await chrome.storage.local.set({ [CARDS_KEY]: nextCards });
    return value;
  });

  cardsMutationQueue = mutation.catch(() => undefined);
  return mutation;
}

function assertLibraryWithinLimits(nextCards, currentCards) {
  if (nextCards.length > MAX_LIBRARY_CARDS && nextCards.length >= currentCards.length) {
    throw new Error(`Pausemark can store up to ${MAX_LIBRARY_CARDS} phrases.`);
  }

  const nextBytes = new TextEncoder().encode(JSON.stringify(nextCards)).byteLength;
  const currentBytes = new TextEncoder().encode(JSON.stringify(currentCards)).byteLength;
  if (nextBytes > MAX_LIBRARY_BYTES && nextBytes >= currentBytes) {
    throw new Error("Pausemark's local library is full. Export or delete phrases before adding more.");
  }
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

function sourceHost(value) {
  try {
    const url = new URL(cleanText(value));
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : "";
  } catch {
    return "";
  }
}

function fallbackDefinition(phrase) {
  return `Saved "${phrase}". AI enrichment is ready once an API key is configured.`;
}

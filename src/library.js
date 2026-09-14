import { EXPORT_SCHEMA_VERSION } from "./export.js";

export const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
// Accept formatted backups with ample headroom; normalized libraries still obey the storage limit.
export const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_LIBRARY_CARDS = 5000;
const IMPORT_SCHEMA_VERSION = EXPORT_SCHEMA_VERSION;
const MAX_PHRASE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 3000;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
const MAX_AI_TEXT_LENGTH = 1200;
const MAX_AI_ITEM_LENGTH = 500;

export function prepareImportedCards(payload) {
  const importedCards = extractImportCards(payload);
  if (importedCards.length > MAX_LIBRARY_CARDS) {
    throw new Error(`An import can contain at most ${MAX_LIBRARY_CARDS} phrases`);
  }
  const cards = collapseDuplicateCards(importedCards.map(normalizeImportedCard).filter(Boolean));
  if (!cards.length) {
    throw new Error("No valid Phraselet phrases found");
  }
  return cards;
}

function extractImportCards(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && ![1, 2, IMPORT_SCHEMA_VERSION].includes(payload.schemaVersion)) {
    throw new Error("This Phraselet export version is not supported.");
  }

  if (Array.isArray(payload?.cards)) {
    return payload.cards;
  }

  throw new Error("No Phraselet phrases were found in that file.");
}

function normalizeImportedCard(card) {
  if (!card || typeof card !== "object") {
    return null;
  }

  const selectedText = cleanText(card.selectedText).slice(0, MAX_PHRASE_LENGTH);
  if (!selectedText) {
    return null;
  }

  const enrichment = card.enrichment ?? card.ai;
  const ai = enrichment && typeof enrichment === "object" ? enrichment : {};

  return {
    id: cleanText(card.id).slice(0, 100) || crypto.randomUUID(),
    selectedText,
    contextText: cleanText(card.contextText).slice(0, MAX_CONTEXT_LENGTH),
    sourceTitle: cleanText(card.sourceTitle).slice(0, MAX_TITLE_LENGTH),
    sourceUrl: safeSourceUrl(cleanText(card.sourceUrl).slice(0, MAX_URL_LENGTH)),
    createdAt: normalizeIsoDate(card.createdAt),
    status: normalizeCardStatus(card.status),
    note: cleanMultilineText(card.note, 2000),
    tags: normalizeTags(card.tags),
    ai: {
      status: ["enriched", "pending", "needs_api_key", "error", "not_requested"].includes(ai.status)
        ? ai.status
        : "not_requested",
      summary: cleanText(ai.summary).slice(0, MAX_AI_TEXT_LENGTH),
      contextMeaning: cleanText(ai.contextMeaning).slice(0, MAX_AI_TEXT_LENGTH),
      examples: Array.isArray(ai.examples)
        ? ai.examples
          .map((item) => cleanText(item).slice(0, MAX_AI_ITEM_LENGTH))
          .filter(Boolean)
          .slice(0, 3)
        : [],
      relatedTerms: Array.isArray(ai.relatedTerms)
        ? ai.relatedTerms
          .map((item) => cleanText(item).slice(0, MAX_AI_ITEM_LENGTH))
          .filter(Boolean)
          .slice(0, 5)
        : [],
      error: cleanText(ai.error).slice(0, 500)
    }
  };
}

function normalizeIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function collapseDuplicateCards(cardList) {
  const identities = [];
  return cardList.reduce((result, card) => {
    const identity = cardIdentity(card);
    const duplicateIndex = result.findIndex((candidate, index) => (
      candidate.id === card.id || identities[index] === identity
    ));

    if (duplicateIndex === -1) {
      result.push(card);
      identities.push(identity);
    } else {
      result[duplicateIndex] = mergeCardRecords(result[duplicateIndex], card);
      identities[duplicateIndex] = cardIdentity(result[duplicateIndex]);
    }

    return result;
  }, []);
}

export function mergeImportedCards(importedCards, existingCards) {
  const remainingCards = [...existingCards];
  const identities = remainingCards.map(cardIdentity);
  const mergedCards = [];
  let added = 0;
  let updated = 0;

  importedCards.forEach((importedCard) => {
    const identity = cardIdentity(importedCard);
    const duplicateIndex = remainingCards.findIndex((candidate, index) => (
      candidate.id === importedCard.id
      || identities[index] === identity
    ));

    if (duplicateIndex === -1) {
      mergedCards.push(importedCard);
      added += 1;
      return;
    }

    const [existingCard] = remainingCards.splice(duplicateIndex, 1);
    identities.splice(duplicateIndex, 1);
    mergedCards.push(mergeCardRecords(existingCard, importedCard));
    updated += 1;
  });

  return {
    cards: [...mergedCards, ...remainingCards],
    added,
    updated
  };
}

function mergeCardRecords(existingCard, incomingCard) {
  const incomingAiHasContent = incomingCard.ai?.summary
    || incomingCard.ai?.contextMeaning
    || incomingCard.ai?.examples?.length
    || incomingCard.ai?.relatedTerms?.length;

  return {
    ...existingCard,
    ...incomingCard,
    id: existingCard.id || incomingCard.id,
    contextText: incomingCard.contextText || existingCard.contextText || "",
    sourceTitle: incomingCard.sourceTitle || existingCard.sourceTitle || "",
    sourceUrl: incomingCard.sourceUrl || existingCard.sourceUrl || "",
    note: incomingCard.note || existingCard.note || "",
    tags: normalizeTags([...(existingCard.tags || []), ...(incomingCard.tags || [])]),
    ai: incomingAiHasContent ? incomingCard.ai : existingCard.ai || incomingCard.ai
  };
}

function normalizeCardStatus(status) {
  return status === "archived" || status === "known" ? "archived" : "current";
}

function safeSourceUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value, maxLength) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeTag(value) {
  return cleanText(value).slice(0, 40);
}

function normalizeTagKey(value) {
  return normalizeTag(value).toLowerCase();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set();
  return tags.map(normalizeTag).filter((tag) => {
    const key = normalizeTagKey(tag);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  }).slice(0, 12);
}

function cardIdentity(card) {
  return `${cleanText(card.selectedText).toLowerCase()}\n${canonicalizeUrl(card.sourceUrl)}`;
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

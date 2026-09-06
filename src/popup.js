const CARDS_KEY = "pausemark.cards";
const STATUS_LABELS = {
  enriched: "Explained",
  pending: "Thinking",
  needs_api_key: "Needs key",
  error: "Error"
};

const cardsEl = document.querySelector("#cards");
const countEl = document.querySelector("#card-count");
const searchEl = document.querySelector("#search");
const tagFilterEl = document.querySelector("#tag-filter");
const saveSelectionEl = document.querySelector("#save-selection");
const optionsEl = document.querySelector("#open-options");
const exportCardsEl = document.querySelector("#export-cards");
const importCardsEl = document.querySelector("#import-cards");
const importFileEl = document.querySelector("#import-file");
const libraryStatusEl = document.querySelector("#library-status");

let cards = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cards = await getCards();
  render();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[CARDS_KEY]) {
      cards = changes[CARDS_KEY].newValue || [];
      render();
    }
  });
}

saveSelectionEl.addEventListener("click", async () => {
  saveSelectionEl.disabled = true;
  saveSelectionEl.textContent = "Saving";

  const result = await chrome.runtime.sendMessage({
    type: "PAUSEMARK_SAVE_ACTIVE_SELECTION"
  });

  saveSelectionEl.disabled = false;
  saveSelectionEl.textContent = result?.ok ? "Saved" : "Save selection";
  setTimeout(() => {
    saveSelectionEl.textContent = "Save selection";
  }, 1200);
});

optionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

exportCardsEl.addEventListener("click", exportCards);

importCardsEl.addEventListener("click", () => {
  importFileEl.click();
});

importFileEl.addEventListener("change", importCards);

searchEl.addEventListener("input", render);
tagFilterEl.addEventListener("change", render);

cardsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "remove-tag") {
    const card = cards.find((candidate) => candidate.id === id);
    if (card) {
      const tagKey = normalizeTagKey(button.dataset.tag);
      await upsertCard({
        ...card,
        tags: normalizeTags(card.tags).filter((tag) => normalizeTagKey(tag) !== tagKey)
      });
    }
  }

  if (action === "delete") {
    await deleteCard(id);
  }

  if (action === "toggle-known") {
    const card = cards.find((candidate) => candidate.id === id);
    if (card) {
      await upsertCard({
        ...card,
        status: card.status === "known" ? "learning" : "known"
      });
    }
  }

  if (action === "enrich") {
    button.disabled = true;
    button.textContent = "Working";
    await chrome.runtime.sendMessage({
      type: "PAUSEMARK_ENRICH_CARD",
      cardId: id
    });
  }
});

cardsEl.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-action='add-tag']");
  if (!form) {
    return;
  }

  event.preventDefault();
  const card = cards.find((candidate) => candidate.id === form.dataset.id);
  const input = form.elements.namedItem("tag");
  const tag = normalizeTag(input?.value);

  if (!card || !tag) {
    return;
  }

  const tags = normalizeTags(card.tags);
  if (tags.some((candidate) => normalizeTagKey(candidate) === normalizeTagKey(tag))) {
    showLibraryStatus(`Already tagged ${tag}.`, true);
    return;
  }

  if (tags.length >= 12) {
    showLibraryStatus("A phrase can have up to 12 tags.", true);
    return;
  }

  await upsertCard({
    ...card,
    tags: [...tags, tag]
  });
  showLibraryStatus(`Added tag ${tag}.`);
});

function render() {
  const query = searchEl.value.trim().toLowerCase();
  renderTagFilter();
  const selectedTag = normalizeTagKey(tagFilterEl.value);
  const visibleCards = cards.filter((card) => {
    const tags = normalizeTags(card.tags);
    const haystack = [
      card.selectedText,
      card.contextText,
      card.sourceTitle,
      card.ai?.summary,
      card.ai?.contextMeaning,
      ...tags
    ].join(" ").toLowerCase();

    const matchesTag = !selectedTag
      || tags.some((tag) => normalizeTagKey(tag) === selectedTag);

    return haystack.includes(query) && matchesTag;
  });

  countEl.textContent = query || selectedTag
    ? `${visibleCards.length} of ${cards.length} phrases`
    : cards.length === 1 ? "1 saved phrase" : `${cards.length} saved phrases`;
  exportCardsEl.disabled = cards.length === 0;

  if (!visibleCards.length) {
    cardsEl.innerHTML = emptyState(query, selectedTag);
    return;
  }

  cardsEl.innerHTML = visibleCards.map(renderCard).join("");
}

function renderCard(card) {
  const ai = card.ai || {};
  const cardId = escapeAttribute(card.id);
  const status = STATUS_LABELS[ai.status] || "Saved";
  const examples = Array.isArray(ai.examples) && ai.examples.length
    ? `<ul>${ai.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>`
    : "";
  const relatedTerms = Array.isArray(ai.relatedTerms) && ai.relatedTerms.length
    ? `<p class="terms">${ai.relatedTerms.map(escapeHtml).join(" / ")}</p>`
    : "";
  const source = card.sourceUrl
    ? `<a href="${escapeAttribute(card.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(card.sourceTitle || hostnameFromUrl(card.sourceUrl))}</a>`
    : "";
  const tags = renderTags(card, cardId);

  return `
    <article class="phrase-card ${card.status === "known" ? "is-known" : ""}">
      <div class="card-header">
        <h2>${escapeHtml(card.selectedText)}</h2>
        <span>${escapeHtml(status)}</span>
      </div>
      ${ai.summary ? `<p>${escapeHtml(ai.summary)}</p>` : ""}
      ${ai.contextMeaning ? `<p class="context-meaning">${escapeHtml(ai.contextMeaning)}</p>` : ""}
      ${examples}
      ${relatedTerms}
      ${tags}
      ${card.contextText ? `<details><summary>Source context</summary><p>${escapeHtml(card.contextText)}</p></details>` : ""}
      ${ai.error ? `<p class="error-text">${escapeHtml(ai.error)}</p>` : ""}
      <footer>
        <div>${source}</div>
        <div class="card-actions">
          <button data-action="enrich" data-id="${cardId}" type="button">Explain</button>
          <button data-action="toggle-known" data-id="${cardId}" type="button">${card.status === "known" ? "Learning" : "Known"}</button>
          <button data-action="delete" data-id="${cardId}" type="button">Delete</button>
        </div>
      </footer>
    </article>
  `;
}

function renderTags(card, cardId) {
  const tags = normalizeTags(card.tags);
  const tagButtons = tags.map((tag) => `
    <button
      class="tag-chip"
      data-action="remove-tag"
      data-id="${cardId}"
      data-tag="${escapeAttribute(tag)}"
      type="button"
      title="Remove tag"
      aria-label="Remove tag ${escapeAttribute(tag)}"
    >${escapeHtml(tag)} <span aria-hidden="true">x</span></button>
  `).join("");

  return `
    <div class="tag-editor">
      ${tagButtons ? `<div class="tag-list" aria-label="Tags">${tagButtons}</div>` : ""}
      <form data-action="add-tag" data-id="${cardId}">
        <input name="tag" type="text" maxlength="40" placeholder="Add tag" aria-label="Add a tag to ${escapeAttribute(card.selectedText)}" autocomplete="off">
        <button type="submit" title="Add tag" aria-label="Add tag">+</button>
      </form>
    </div>
  `;
}

function emptyState(query, selectedTag) {
  const filtered = query || selectedTag;
  return `
    <section class="empty-state">
      <h2>${filtered ? "No matches" : "Save what made you pause."}</h2>
      <p>${filtered ? "Try a different search or tag." : "Highlight text on a page, press Alt/Option+Shift+S, or right-click and choose Save to Pausemark."}</p>
    </section>
  `;
}

function renderTagFilter() {
  const previousValue = normalizeTagKey(tagFilterEl.value);
  const tags = normalizeTags(cards.flatMap((card) => card.tags || []))
    .sort((left, right) => left.localeCompare(right));

  tagFilterEl.innerHTML = [
    '<option value="">All tags</option>',
    ...tags.map((tag) => `<option value="${escapeAttribute(tag)}">${escapeHtml(tag)}</option>`)
  ].join("");

  const selectedTag = tags.find((tag) => normalizeTagKey(tag) === previousValue);
  tagFilterEl.value = selectedTag || "";
  tagFilterEl.disabled = tags.length === 0;
}

async function getCards() {
  const result = await chrome.storage.local.get(CARDS_KEY);
  return Array.isArray(result[CARDS_KEY]) ? result[CARDS_KEY] : [];
}

async function upsertCard(card) {
  const nextCards = [
    card,
    ...cards.filter((candidate) => candidate.id !== card.id)
  ];
  await chrome.storage.local.set({ [CARDS_KEY]: nextCards });
}

async function deleteCard(id) {
  await chrome.storage.local.set({
    [CARDS_KEY]: cards.filter((card) => card.id !== id)
  });
}

function exportCards() {
  if (!cards.length) {
    showLibraryStatus("No saved phrases to export.", true);
    return;
  }

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    cards
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pausemark-export-${dateStamp()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showLibraryStatus(`Exported ${phraseCount(cards.length)}.`);
}

async function importCards() {
  const [file] = importFileEl.files;
  importFileEl.value = "";

  if (!file) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    const importedCards = extractImportCards(payload);
    const normalizedCards = uniqueCardsById(
      importedCards.map(normalizeImportedCard).filter(Boolean)
    );

    if (!normalizedCards.length) {
      showLibraryStatus("No valid Pausemark phrases found.", true);
      return;
    }

    const importedIds = new Set(normalizedCards.map((card) => card.id));
    const nextCards = [
      ...normalizedCards,
      ...cards.filter((card) => !importedIds.has(card.id))
    ];

    await chrome.storage.local.set({ [CARDS_KEY]: nextCards });
    showLibraryStatus(`Imported ${phraseCount(normalizedCards.length)}.`);
  } catch {
    showLibraryStatus("Import failed. Choose a valid Pausemark JSON file.", true);
  }
}

function extractImportCards(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.cards)) {
    return payload.cards;
  }

  return [];
}

function normalizeImportedCard(card) {
  if (!card || typeof card !== "object") {
    return null;
  }

  const selectedText = cleanText(card.selectedText);
  if (!selectedText) {
    return null;
  }

  const ai = card.ai && typeof card.ai === "object" ? card.ai : {};

  return {
    id: cleanText(card.id) || crypto.randomUUID(),
    selectedText,
    contextText: cleanText(card.contextText),
    sourceTitle: cleanText(card.sourceTitle),
    sourceUrl: cleanText(card.sourceUrl),
    createdAt: cleanText(card.createdAt) || new Date().toISOString(),
    status: card.status === "known" ? "known" : "learning",
    note: cleanText(card.note),
    tags: normalizeTags(card.tags),
    ai: {
      status: ["enriched", "pending", "needs_api_key", "error"].includes(ai.status)
        ? ai.status
        : "pending",
      summary: cleanText(ai.summary),
      contextMeaning: cleanText(ai.contextMeaning),
      examples: Array.isArray(ai.examples)
        ? ai.examples.map(cleanText).filter(Boolean).slice(0, 3)
        : [],
      relatedTerms: Array.isArray(ai.relatedTerms)
        ? ai.relatedTerms.map(cleanText).filter(Boolean).slice(0, 5)
        : [],
      error: cleanText(ai.error)
    }
  };
}

function uniqueCardsById(cardList) {
  const byId = new Map();
  cardList.forEach((card) => {
    byId.set(card.id, card);
  });
  return [...byId.values()];
}

function showLibraryStatus(message, isError = false) {
  libraryStatusEl.textContent = message;
  libraryStatusEl.classList.toggle("is-error", isError);
  setTimeout(() => {
    if (libraryStatusEl.textContent === message) {
      libraryStatusEl.textContent = "";
      libraryStatusEl.classList.remove("is-error");
    }
  }, 2200);
}

function phraseCount(count) {
  return count === 1 ? "1 phrase" : `${count} phrases`;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

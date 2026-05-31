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

cardsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;
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

function render() {
  const query = searchEl.value.trim().toLowerCase();
  const visibleCards = cards.filter((card) => {
    const haystack = [
      card.selectedText,
      card.contextText,
      card.sourceTitle,
      card.ai?.summary,
      card.ai?.contextMeaning
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });

  countEl.textContent = cards.length === 1 ? "1 saved phrase" : `${cards.length} saved phrases`;
  exportCardsEl.disabled = cards.length === 0;

  if (!visibleCards.length) {
    cardsEl.innerHTML = emptyState(query);
    return;
  }

  cardsEl.innerHTML = visibleCards.map(renderCard).join("");
}

function renderCard(card) {
  const ai = card.ai || {};
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
      ${card.contextText ? `<details><summary>Source context</summary><p>${escapeHtml(card.contextText)}</p></details>` : ""}
      ${ai.error ? `<p class="error-text">${escapeHtml(ai.error)}</p>` : ""}
      <footer>
        <div>${source}</div>
        <div class="card-actions">
          <button data-action="enrich" data-id="${card.id}" type="button">Explain</button>
          <button data-action="toggle-known" data-id="${card.id}" type="button">${card.status === "known" ? "Learning" : "Known"}</button>
          <button data-action="delete" data-id="${card.id}" type="button">Delete</button>
        </div>
      </footer>
    </article>
  `;
}

function emptyState(query) {
  return `
    <section class="empty-state">
      <h2>${query ? "No matches" : "Save what made you pause."}</h2>
      <p>${query ? "Try a different search." : "Highlight text on a page, press Alt/Option+Shift+S, or right-click and choose Save to Pausemark."}</p>
    </section>
  `;
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

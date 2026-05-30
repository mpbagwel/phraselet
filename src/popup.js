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

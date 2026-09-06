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
const tagSuggestionsEl = document.querySelector("#tag-suggestions");
const manageTagEl = document.querySelector("#manage-tag");
const tagManagerEl = document.querySelector("#tag-manager");
const tagManagerFormEl = document.querySelector("#tag-manager-form");
const tagNameEl = document.querySelector("#tag-name");
const deleteTagEl = document.querySelector("#delete-tag");
const saveSelectionEl = document.querySelector("#save-selection");
const optionsEl = document.querySelector("#open-options");
const exportCardsEl = document.querySelector("#export-cards");
const importCardsEl = document.querySelector("#import-cards");
const importFileEl = document.querySelector("#import-file");
const libraryStatusEl = document.querySelector("#library-status");

let cards = [];
let pendingTagSelection = null;

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
  setCaptureButtonLabel("Saving…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "PAUSEMARK_SAVE_ACTIVE_SELECTION"
    });

    setCaptureButtonLabel(result?.ok
      ? result.duplicate ? "Already saved" : "Saved"
      : "Save selection");
    if (!result?.ok) {
      showLibraryStatus(result?.error || "Could not save the selection.", true);
    }
  } catch {
    setCaptureButtonLabel("Save selection");
    showLibraryStatus("Could not reach Pausemark. Reload the extension and try again.", true);
  } finally {
    saveSelectionEl.disabled = false;
    setTimeout(() => {
      setCaptureButtonLabel("Save selection");
    }, 1200);
  }
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
tagFilterEl.addEventListener("change", () => {
  closeTagManager();
  render();
});
manageTagEl.addEventListener("click", toggleTagManager);
tagManagerFormEl.addEventListener("submit", renameSelectedTag);
deleteTagEl.addEventListener("click", deleteSelectedTag);

cardsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "toggle-panel") {
    toggleCardPanel(button);
    return;
  }

  if (action === "focus-card") {
    focusCard(id);
    return;
  }

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
  const form = event.target.closest("form[data-action]");
  if (!form) {
    return;
  }

  event.preventDefault();

  if (form.dataset.action === "edit-card") {
    await saveCardEdits(form);
    return;
  }

  if (form.dataset.action !== "add-tag") {
    return;
  }

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

async function saveCardEdits(form) {
  const card = cards.find((candidate) => candidate.id === form.dataset.id);
  if (!card) {
    return;
  }

  const selectedText = cleanText(form.elements.namedItem("selectedText")?.value);
  const contextText = cleanText(form.elements.namedItem("contextText")?.value);
  const sourceTitle = cleanText(form.elements.namedItem("sourceTitle")?.value);
  const note = cleanMultilineText(form.elements.namedItem("note")?.value, 2000);

  if (!selectedText) {
    showLibraryStatus("A phrase cannot be empty.", true);
    return;
  }

  const duplicate = cards.find((candidate) => (
    candidate.id !== card.id
    && cardIdentity(candidate) === cardIdentity({ selectedText, sourceUrl: card.sourceUrl })
  ));
  if (duplicate) {
    showLibraryStatus("That phrase is already saved from this page.", true);
    return;
  }

  const explanationChanged = selectedText !== cleanText(card.selectedText)
    || contextText !== cleanText(card.contextText);
  const updatedCard = {
    ...card,
    selectedText,
    contextText,
    sourceTitle,
    note
  };

  await upsertCard(updatedCard);
  showLibraryStatus("Saved changes.");

  if (explanationChanged) {
    chrome.runtime.sendMessage({
      type: "PAUSEMARK_ENRICH_CARD",
      cardId: card.id
    }).catch(() => undefined);
  }
}

function focusCard(id) {
  searchEl.value = "";
  tagFilterEl.value = "";
  closeTagManager();
  render();

  const cardEl = [...cardsEl.querySelectorAll("[data-card-id]")]
    .find((candidate) => candidate.dataset.cardId === id);
  if (!cardEl) {
    return;
  }

  cardEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  cardEl.classList.add("is-focused");
  setTimeout(() => cardEl.classList.remove("is-focused"), 1600);
}

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
  const morePanelId = disclosureId(card.id, "more");
  const relatedPanelId = disclosureId(card.id, "related");
  const contextPanelId = disclosureId(card.id, "context");
  const editPanelId = disclosureId(card.id, "edit");
  const status = STATUS_LABELS[ai.status] || "Saved";
  const statusClass = Object.hasOwn(STATUS_LABELS, ai.status) ? ai.status : "saved";
  const examples = Array.isArray(ai.examples) && ai.examples.length
    ? `<ul class="examples">${ai.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>`
    : "";
  const relatedTerms = Array.isArray(ai.relatedTerms) && ai.relatedTerms.length
    ? `<p class="terms">${ai.relatedTerms.map(escapeHtml).join(" / ")}</p>`
    : "";
  const enrichmentPanel = examples || relatedTerms
    ? `<div id="${morePanelId}" class="card-disclosure-panel enrichment-details-content" data-panel-id="more" hidden>${examples}${relatedTerms}</div>`
    : "";
  const source = card.sourceUrl
    ? `<a class="source-link" href="${escapeAttribute(card.sourceUrl)}" target="_blank" rel="noreferrer" title="Open source: ${escapeAttribute(card.sourceTitle || hostnameFromUrl(card.sourceUrl))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v6H5V6h6"/></svg>
        <span>${escapeHtml(card.sourceTitle || hostnameFromUrl(card.sourceUrl))}</span>
      </a>`
    : "";
  const tags = renderTags(card, cardId);
  const note = card.note
    ? `<p class="card-note">${escapeHtml(card.note)}</p>`
    : "";
  const relatedPhrases = renderRelatedPhrases(card, relatedPanelId);
  const editor = renderCardEditor(card, cardId, editPanelId);
  const context = card.contextText
    ? `<div id="${contextPanelId}" class="card-disclosure-panel source-context" data-panel-id="context" hidden><p>${escapeHtml(card.contextText)}</p></div>`
    : "";
  const isKnown = card.status === "known";

  return `
    <article class="phrase-card ${isKnown ? "is-known" : ""}" data-card-id="${cardId}">
      <div class="card-header">
        <h2>${escapeHtml(card.selectedText)}</h2>
        <span class="status-badge status-${statusClass}">${escapeHtml(status)}</span>
      </div>
      ${note}
      ${ai.summary ? `<p class="card-summary">${escapeHtml(ai.summary)}</p>` : ""}
      ${ai.contextMeaning ? `<p class="context-meaning">${escapeHtml(ai.contextMeaning)}</p>` : ""}
      ${tags}
      ${ai.error ? `<p class="error-text">${escapeHtml(ai.error)}</p>` : ""}
      <div class="card-disclosures">
        <div class="card-disclosure-controls">
          ${enrichmentPanel ? renderDisclosureControl("more", "More", morePanelId) : ""}
          ${relatedPhrases ? renderDisclosureControl("related", `Related (${relatedPhrases.count})`, relatedPanelId) : ""}
          ${context ? renderDisclosureControl("context", "Context", contextPanelId) : ""}
          ${renderDisclosureControl("edit", "Edit", editPanelId)}
        </div>
        <div class="card-disclosure-panels">
          ${enrichmentPanel}
          ${relatedPhrases ? relatedPhrases.panel : ""}
          ${context}
          ${editor}
        </div>
      </div>
      <footer class="card-footer">
        <div>${source}</div>
        <div class="card-actions">
          <button data-action="enrich" data-id="${cardId}" type="button">Explain</button>
          <button data-action="toggle-known" data-id="${cardId}" type="button" aria-pressed="${isKnown}">${isKnown ? "Learning" : "Known"}</button>
          <button class="delete-action" data-action="delete" data-id="${cardId}" type="button">Delete</button>
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
      <details class="add-tag-disclosure">
        <summary>Add tag</summary>
        <form data-action="add-tag" data-id="${cardId}">
          <input name="tag" type="text" maxlength="40" placeholder="Tag name" aria-label="Add a tag to ${escapeAttribute(card.selectedText)}" list="tag-suggestions" autocomplete="off">
          <button type="submit" title="Add tag" aria-label="Add tag">+</button>
        </form>
      </details>
    </div>
  `;
}

function renderRelatedPhrases(card, panelId) {
  const relatedCards = findRelatedCards(card);
  if (!relatedCards.length) {
    return null;
  }

  const links = relatedCards.map(({ card: relatedCard, sharedTags }) => `
    <button data-action="focus-card" data-id="${escapeAttribute(relatedCard.id)}" type="button">
      ${escapeHtml(relatedCard.selectedText)}
      <span>${sharedTags} shared ${sharedTags === 1 ? "tag" : "tags"}</span>
    </button>
  `).join("");

  return {
    count: relatedCards.length,
    panel: `<div id="${panelId}" class="card-disclosure-panel related-list" data-panel-id="related" hidden>${links}</div>`
  };
}

function findRelatedCards(card) {
  const tagKeys = new Set(normalizeTags(card.tags).map(normalizeTagKey));
  if (!tagKeys.size) {
    return [];
  }

  return cards
    .filter((candidate) => candidate.id !== card.id)
    .map((candidate) => ({
      card: candidate,
      sharedTags: normalizeTags(candidate.tags)
        .filter((tag) => tagKeys.has(normalizeTagKey(tag))).length
    }))
    .filter((candidate) => candidate.sharedTags > 0)
    .sort((left, right) => right.sharedTags - left.sharedTags)
    .slice(0, 5);
}

function renderCardEditor(card, cardId, panelId) {
  return `
    <div id="${panelId}" class="card-editor card-disclosure-panel" data-panel-id="edit" hidden>
      <form data-action="edit-card" data-id="${cardId}">
        <label>
          <span>Phrase</span>
          <input name="selectedText" type="text" maxlength="500" value="${escapeAttribute(card.selectedText)}" required>
        </label>
        <label>
          <span>Personal note</span>
          <textarea name="note" maxlength="2000" rows="3">${escapeHtml(card.note)}</textarea>
        </label>
        <label>
          <span>Source title</span>
          <input name="sourceTitle" type="text" maxlength="300" value="${escapeAttribute(card.sourceTitle)}">
        </label>
        <label>
          <span>Source context</span>
          <textarea name="contextText" maxlength="3000" rows="4">${escapeHtml(card.contextText)}</textarea>
        </label>
        <button class="primary-button" type="submit">Save changes</button>
      </form>
    </div>
  `;
}

function renderDisclosureControl(panel, label, panelId) {
  return `
    <button data-action="toggle-panel" data-panel="${panel}" type="button" aria-expanded="false" aria-controls="${panelId}">
      <span class="disclosure-symbol" aria-hidden="true">+</span>${label}
    </button>
  `;
}

function disclosureId(cardId, panel) {
  const token = String(cardId).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `card-${token}-${panel}`;
}

function toggleCardPanel(button) {
  const cardEl = button.closest("[data-card-id]");
  const panelEl = [...cardEl.querySelectorAll("[data-panel-id]")]
    .find((candidate) => candidate.dataset.panelId === button.dataset.panel);

  if (!panelEl) {
    return;
  }

  const isOpen = panelEl.hidden;
  panelEl.hidden = !isOpen;
  button.setAttribute("aria-expanded", String(isOpen));
  button.querySelector(".disclosure-symbol").textContent = isOpen ? "−" : "+";
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
  const requestedValue = pendingTagSelection === null
    ? tagFilterEl.value
    : pendingTagSelection;
  const previousValue = normalizeTagKey(requestedValue);
  pendingTagSelection = null;
  const tags = normalizeTags(cards.flatMap((card) => card.tags || []))
    .sort((left, right) => left.localeCompare(right));

  tagFilterEl.innerHTML = [
    '<option value="">All tags</option>',
    ...tags.map((tag) => `<option value="${escapeAttribute(tag)}">${escapeHtml(tag)}</option>`)
  ].join("");
  tagSuggestionsEl.innerHTML = tags
    .map((tag) => `<option value="${escapeAttribute(tag)}"></option>`)
    .join("");

  const selectedTag = tags.find((tag) => normalizeTagKey(tag) === previousValue);
  tagFilterEl.value = selectedTag || "";
  tagFilterEl.disabled = tags.length === 0;
  manageTagEl.disabled = !selectedTag;

  if (!tagManagerEl.hidden) {
    if (selectedTag) {
      tagNameEl.value = selectedTag;
    } else {
      closeTagManager();
    }
  }
}

function toggleTagManager() {
  if (manageTagEl.disabled) {
    return;
  }

  tagManagerEl.hidden = !tagManagerEl.hidden;
  manageTagEl.textContent = tagManagerEl.hidden ? "Manage" : "Close";
  manageTagEl.setAttribute("aria-expanded", String(!tagManagerEl.hidden));

  if (!tagManagerEl.hidden) {
    tagNameEl.value = tagFilterEl.value;
    tagNameEl.focus();
    tagNameEl.select();
  }
}

function closeTagManager() {
  tagManagerEl.hidden = true;
  manageTagEl.textContent = "Manage";
  manageTagEl.setAttribute("aria-expanded", "false");
}

async function renameSelectedTag(event) {
  event.preventDefault();
  const currentTag = normalizeTag(tagFilterEl.value);
  const nextTag = normalizeTag(tagNameEl.value);

  if (!currentTag || !nextTag) {
    showLibraryStatus("Enter a tag name.", true);
    return;
  }

  if (normalizeTagKey(currentTag) === normalizeTagKey(nextTag)) {
    closeTagManager();
    return;
  }

  pendingTagSelection = nextTag;
  await chrome.storage.local.set({
    [CARDS_KEY]: cards.map((card) => ({
      ...card,
      tags: normalizeTags(
        normalizeTags(card.tags)
          .map((tag) => normalizeTagKey(tag) === normalizeTagKey(currentTag) ? nextTag : tag)
      )
    }))
  });
  closeTagManager();
  showLibraryStatus(`Renamed ${currentTag} to ${nextTag}.`);
}

async function deleteSelectedTag() {
  const currentTag = normalizeTag(tagFilterEl.value);
  if (!currentTag) {
    return;
  }

  if (!window.confirm(`Remove the tag "${currentTag}" from every phrase?`)) {
    return;
  }

  pendingTagSelection = "";
  await chrome.storage.local.set({
    [CARDS_KEY]: cards.map((card) => ({
      ...card,
      tags: normalizeTags(card.tags)
        .filter((tag) => normalizeTagKey(tag) !== normalizeTagKey(currentTag))
    }))
  });
  closeTagManager();
  showLibraryStatus(`Deleted tag ${currentTag}.`);
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
    const normalizedCards = collapseDuplicateCards(
      importedCards.map(normalizeImportedCard).filter(Boolean)
    );

    if (!normalizedCards.length) {
      showLibraryStatus("No valid Pausemark phrases found.", true);
      return;
    }

    const importResult = mergeImportedCards(normalizedCards, cards);

    await chrome.storage.local.set({ [CARDS_KEY]: importResult.cards });
    showLibraryStatus(formatImportStatus(importResult));
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
    note: cleanMultilineText(card.note, 2000),
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

function collapseDuplicateCards(cardList) {
  return cardList.reduce((result, card) => {
    const duplicateIndex = result.findIndex((candidate) => (
      candidate.id === card.id || cardIdentity(candidate) === cardIdentity(card)
    ));

    if (duplicateIndex === -1) {
      result.push(card);
    } else {
      result[duplicateIndex] = mergeCardRecords(result[duplicateIndex], card);
    }

    return result;
  }, []);
}

function mergeImportedCards(importedCards, existingCards) {
  const remainingCards = [...existingCards];
  const mergedCards = [];
  let added = 0;
  let updated = 0;

  importedCards.forEach((importedCard) => {
    const duplicateIndex = remainingCards.findIndex((candidate) => (
      candidate.id === importedCard.id
      || cardIdentity(candidate) === cardIdentity(importedCard)
    ));

    if (duplicateIndex === -1) {
      mergedCards.push(importedCard);
      added += 1;
      return;
    }

    const [existingCard] = remainingCards.splice(duplicateIndex, 1);
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

function formatImportStatus({ added, updated }) {
  const parts = [];
  if (added) {
    parts.push(`${added} added`);
  }
  if (updated) {
    parts.push(`${updated} updated`);
  }
  return `Import complete: ${parts.join(", ")}.`;
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

function setCaptureButtonLabel(label) {
  const labelEl = saveSelectionEl.querySelector("span");
  if (labelEl) {
    labelEl.textContent = label;
  }
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

import { FEATURES } from "./features.js";
import {
  createExportFile,
  createPlainTextExport,
  EXPORT_SCHEMA_VERSION
} from "./export.js";
import {
  createBackupState,
  createSnoozedBackupState,
  shouldShowBackupReminder
} from "./backup.js";
import { rankCards } from "./search.js";

const CARDS_KEY = "phraselet.cards";
const BACKUP_REMINDER_KEY = "phraselet.backupReminder";
const IMPORT_SCHEMA_VERSION = EXPORT_SCHEMA_VERSION;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_CARDS = 5000;
const MAX_PHRASE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 3000;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
const MAX_AI_TEXT_LENGTH = 1200;
const MAX_AI_ITEM_LENGTH = 500;
const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
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
const statusFilterEl = document.querySelector("#status-filter");
const tagSuggestionsEl = document.querySelector("#tag-suggestions");
const manageTagEl = document.querySelector("#manage-tag");
const tagManagerEl = document.querySelector("#tag-manager");
const tagManagerFormEl = document.querySelector("#tag-manager-form");
const tagNameEl = document.querySelector("#tag-name");
const deleteTagEl = document.querySelector("#delete-tag");
const saveSelectionEl = document.querySelector("#save-selection");
const optionsEl = document.querySelector("#open-options");
const exportCardsEl = document.querySelector("#export-cards");
const exportMenuShellEl = document.querySelector("#export-menu-shell");
const exportMenuEl = document.querySelector("#export-menu");
const importCardsEl = document.querySelector("#import-cards");
const importFileEl = document.querySelector("#import-file");
const backupReminderEl = document.querySelector("#backup-reminder");
const backupNowEl = document.querySelector("#backup-now");
const backupLaterEl = document.querySelector("#backup-later");
const libraryStatusEl = document.querySelector("#library-status");
const toggleSelectionEl = document.querySelector("#toggle-selection");
const bulkActionsEl = document.querySelector("#bulk-actions");
const bulkSelectAllEl = document.querySelector("#bulk-select-all");
const bulkSelectAllLabelEl = document.querySelector("#bulk-select-all-label");
const bulkSelectionCountEl = document.querySelector("#bulk-selection-count");
const clearSelectionEl = document.querySelector("#clear-selection");
const bulkTagNameEl = document.querySelector("#bulk-tag-name");
const bulkAddTagEl = document.querySelector("#bulk-add-tag");
const bulkRemoveTagEl = document.querySelector("#bulk-remove-tag");
const bulkCopyEl = document.querySelector("#bulk-copy");
const bulkExportFormatEl = document.querySelector("#bulk-export-format");
const bulkExportEl = document.querySelector("#bulk-export");
const bulkMarkKnownEl = document.querySelector("#bulk-mark-known");
const bulkMarkLearningEl = document.querySelector("#bulk-mark-learning");
const bulkDeleteEl = document.querySelector("#bulk-delete");

let cards = [];
let backupReminder = {};
let pendingTagSelection = null;
let selectionMode = false;
const selectedCardIds = new Set();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [cards, backupReminder] = await Promise.all([
    getCards(),
    getBackupReminder()
  ]);
  render();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[CARDS_KEY]) {
      cards = changes[CARDS_KEY].newValue || [];
      if (!cards.length) {
        selectionMode = false;
        selectedCardIds.clear();
      }
      const currentIds = new Set(cards.map((card) => card.id));
      [...selectedCardIds].forEach((id) => {
        if (!currentIds.has(id)) {
          selectedCardIds.delete(id);
        }
      });
    }

    if (changes[BACKUP_REMINDER_KEY]) {
      backupReminder = normalizeBackupReminder(changes[BACKUP_REMINDER_KEY].newValue);
    }

    render();
  });
}

saveSelectionEl.addEventListener("click", async () => {
  saveSelectionEl.disabled = true;
  setCaptureButtonLabel("Saving…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "PHRASELET_SAVE_ACTIVE_SELECTION"
    });

    setCaptureButtonLabel(result?.ok
      ? result.truncated ? "Shortened" : result.duplicate ? "Already saved" : "Saved"
      : "Save");
    if (!result?.ok) {
      showLibraryStatus(result?.error || "Could not save the selection.", true);
    } else if (result.truncated) {
      showLibraryStatus(`Saved a shortened selection (${MAX_PHRASE_LENGTH}-character limit).`);
    }
  } catch {
    setCaptureButtonLabel("Save");
    showLibraryStatus("Could not reach Phraselet. Reload the extension and try again.", true);
  } finally {
    saveSelectionEl.disabled = false;
    setTimeout(() => {
      setCaptureButtonLabel("Save");
    }, 1200);
  }
});

optionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

exportCardsEl.addEventListener("click", toggleExportMenu);
exportMenuEl.addEventListener("click", exportFromMenu);
document.addEventListener("click", closeExportMenuFromOutside);
document.addEventListener("keydown", closeExportMenuWithKeyboard);

importCardsEl.addEventListener("click", () => {
  importFileEl.click();
});

importFileEl.addEventListener("change", importCards);
toggleSelectionEl.addEventListener("click", toggleSelectionMode);
bulkSelectAllEl.addEventListener("change", toggleAllMatchingCards);
clearSelectionEl.addEventListener("click", clearBulkSelection);
bulkAddTagEl.addEventListener("click", () => applyBulkAction("add_tag"));
bulkRemoveTagEl.addEventListener("click", () => applyBulkAction("remove_tag"));
bulkCopyEl.addEventListener("click", copySelectedPhrases);
bulkExportEl.addEventListener("click", exportSelectedPhrases);
bulkMarkKnownEl.addEventListener("click", () => applyBulkAction("mark_known"));
bulkMarkLearningEl.addEventListener("click", () => applyBulkAction("mark_learning"));
bulkDeleteEl.addEventListener("click", deleteSelectedCards);
backupNowEl.addEventListener("click", exportBackupNow);
backupLaterEl.addEventListener("click", snoozeBackupReminder);

searchEl.addEventListener("input", render);
statusFilterEl.addEventListener("change", render);
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

  if (FEATURES.aiEnrichment && action === "enrich") {
    button.disabled = true;
    button.textContent = "Working";
    await chrome.runtime.sendMessage({
      type: "PHRASELET_ENRICH_CARD",
      cardId: id
    });
  }
});

cardsEl.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[data-action="select-card"]');
  if (!checkbox) {
    return;
  }

  if (checkbox.checked) {
    selectedCardIds.add(checkbox.dataset.id);
  } else {
    selectedCardIds.delete(checkbox.dataset.id);
  }
  render();
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

  if (FEATURES.aiEnrichment && explanationChanged) {
    chrome.runtime.sendMessage({
      type: "PHRASELET_ENRICH_CARD",
      cardId: card.id
    }).catch(() => undefined);
  }
}

function toggleSelectionMode() {
  selectionMode = !selectionMode;
  if (!selectionMode) {
    selectedCardIds.clear();
    bulkTagNameEl.value = "";
  }
  closeTagManager();
  render();
}

function toggleAllMatchingCards() {
  const visibleIds = getVisibleCards().map((card) => card.id);

  if (bulkSelectAllEl.checked) {
    visibleIds.forEach((id) => selectedCardIds.add(id));
  } else {
    visibleIds.forEach((id) => selectedCardIds.delete(id));
  }
  render();
}

function clearBulkSelection() {
  selectedCardIds.clear();
  render();
}

async function applyBulkAction(operation) {
  const tag = normalizeTag(bulkTagNameEl.value);
  if (["add_tag", "remove_tag"].includes(operation) && !tag) {
    showLibraryStatus("Enter a tag name.", true);
    bulkTagNameEl.focus();
    return;
  }

  setBulkControlsDisabled(true);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "PHRASELET_BULK_UPDATE_CARDS",
      operation,
      cardIds: [...selectedCardIds],
      tag
    });

    if (!result?.ok) {
      showLibraryStatus(result?.error || "Could not update the selected phrases.", true);
      return;
    }

    const changedPhrases = phraseCount(result.changed);
    const statusMessage = {
      add_tag: `Added ${tag} to ${changedPhrases}.`,
      remove_tag: `Removed ${tag} from ${changedPhrases}.`,
      mark_known: `Marked ${changedPhrases} as known.`,
      mark_learning: `Marked ${changedPhrases} as learning.`
    }[operation];
    showLibraryStatus(statusMessage);

    if (["add_tag", "remove_tag"].includes(operation)) {
      bulkTagNameEl.value = "";
    }
  } catch {
    showLibraryStatus("Could not update the selected phrases.", true);
  } finally {
    setBulkControlsDisabled(false);
    render();
  }
}

async function deleteSelectedCards() {
  const count = selectedCardIds.size;
  if (!count || !window.confirm(`Delete ${phraseCount(count)}? This cannot be undone.`)) {
    return;
  }

  setBulkControlsDisabled(true);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "PHRASELET_BULK_UPDATE_CARDS",
      operation: "delete",
      cardIds: [...selectedCardIds]
    });

    if (!result?.ok) {
      showLibraryStatus(result?.error || "Could not delete the selected phrases.", true);
      return;
    }

    selectedCardIds.clear();
    showLibraryStatus(`Deleted ${phraseCount(result.changed)}.`);
  } catch {
    showLibraryStatus("Could not delete the selected phrases.", true);
  } finally {
    setBulkControlsDisabled(false);
    render();
  }
}

function setBulkControlsDisabled(disabled) {
  [
    bulkSelectAllEl,
    clearSelectionEl,
    bulkTagNameEl,
    bulkAddTagEl,
    bulkRemoveTagEl,
    bulkCopyEl,
    bulkExportFormatEl,
    bulkExportEl,
    bulkMarkKnownEl,
    bulkMarkLearningEl,
    bulkDeleteEl
  ].forEach((control) => {
    control.disabled = disabled;
  });
}

function focusCard(id) {
  searchEl.value = "";
  tagFilterEl.value = "";
  statusFilterEl.value = "";
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
  renderTagFilter();
  const query = searchEl.value.trim();
  const selectedTag = normalizeTagKey(tagFilterEl.value);
  const selectedStatus = statusFilterEl.value;
  const visibleCards = getVisibleCards(query, selectedTag, selectedStatus);

  countEl.textContent = query || selectedTag || selectedStatus
    ? `${visibleCards.length} of ${cards.length} phrases`
    : cards.length === 1 ? "1 saved phrase" : `${cards.length} saved phrases`;
  exportCardsEl.disabled = cards.length === 0;
  toggleSelectionEl.disabled = cards.length === 0 && !selectionMode;
  if (!cards.length) {
    closeExportMenu();
  }
  renderBackupReminder();
  renderBulkActions(visibleCards);

  if (!visibleCards.length) {
    cardsEl.innerHTML = emptyState(query, selectedTag, selectedStatus);
    return;
  }

  cardsEl.innerHTML = visibleCards.map(renderCard).join("");
}

function getVisibleCards(
  query = searchEl.value.trim(),
  selectedTag = normalizeTagKey(tagFilterEl.value),
  selectedStatus = statusFilterEl.value
) {
  return rankCards(cards, {
    query,
    tag: selectedTag,
    status: selectedStatus,
    includeEnrichment: FEATURES.aiEnrichment
  });
}

function renderBulkActions(visibleCards) {
  bulkActionsEl.hidden = !selectionMode;
  toggleSelectionEl.textContent = selectionMode ? "Done" : "Select";
  toggleSelectionEl.setAttribute("aria-pressed", String(selectionMode));

  if (!selectionMode) {
    return;
  }

  const visibleIds = visibleCards.map((card) => card.id);
  const visibleSelected = visibleIds.filter((id) => selectedCardIds.has(id)).length;
  const hasSelection = selectedCardIds.size > 0;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelected === visibleIds.length;

  bulkSelectAllEl.checked = allVisibleSelected;
  bulkSelectAllEl.indeterminate = visibleSelected > 0 && !allVisibleSelected;
  bulkSelectAllEl.disabled = visibleIds.length === 0;
  bulkSelectAllLabelEl.textContent = visibleIds.length
    ? `Select all ${visibleIds.length} matching`
    : "No matching phrases";
  bulkSelectionCountEl.textContent = `${selectedCardIds.size} selected`;
  clearSelectionEl.disabled = !hasSelection;
  bulkTagNameEl.disabled = !hasSelection;
  bulkAddTagEl.disabled = !hasSelection;
  bulkRemoveTagEl.disabled = !hasSelection;
  bulkCopyEl.disabled = !hasSelection;
  bulkExportFormatEl.disabled = !hasSelection;
  bulkExportEl.disabled = !hasSelection;
  bulkMarkKnownEl.disabled = !hasSelection;
  bulkMarkLearningEl.disabled = !hasSelection;
  bulkDeleteEl.disabled = !hasSelection;
}

function renderCard(card) {
  const ai = card.ai || {};
  const cardId = escapeAttribute(card.id);
  const morePanelId = disclosureId(card.id, "more");
  const relatedPanelId = disclosureId(card.id, "related");
  const contextPanelId = disclosureId(card.id, "context");
  const editPanelId = disclosureId(card.id, "edit");
  const isKnown = card.status === "known";
  const status = FEATURES.aiEnrichment
    ? STATUS_LABELS[ai.status] || (isKnown ? "Known" : "Learning")
    : isKnown ? "Known" : "Learning";
  const statusClass = FEATURES.aiEnrichment && Object.hasOwn(STATUS_LABELS, ai.status)
    ? ai.status
    : isKnown ? "known" : "learning";
  const examples = FEATURES.aiEnrichment && Array.isArray(ai.examples) && ai.examples.length
    ? `<ul class="examples">${ai.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>`
    : "";
  const relatedTerms = FEATURES.aiEnrichment && Array.isArray(ai.relatedTerms) && ai.relatedTerms.length
    ? `<p class="terms">${ai.relatedTerms.map(escapeHtml).join(" / ")}</p>`
    : "";
  const enrichmentPanel = examples || relatedTerms
    ? `<div id="${morePanelId}" class="card-disclosure-panel enrichment-details-content" data-panel-id="more" hidden>${examples}${relatedTerms}</div>`
    : "";
  const sourceUrl = safeSourceUrl(card.sourceUrl);
  const sourceLabel = cleanText(card.sourceTitle || hostnameFromUrl(sourceUrl));
  const source = sourceUrl
    ? `<a class="source-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer" title="Open source: ${escapeAttribute(sourceLabel)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v6H5V6h6"/></svg>
        <span>${escapeHtml(sourceLabel)}</span>
      </a>`
    : sourceLabel ? `<span class="source-label">${escapeHtml(sourceLabel)}</span>` : "";
  const tags = renderTags(card, cardId);
  const note = card.note
    ? `<p class="card-note">${escapeHtml(card.note)}</p>`
    : "";
  const relatedPhrases = renderRelatedPhrases(card, relatedPanelId);
  const editor = renderCardEditor(card, cardId, editPanelId);
  const context = card.contextText
    ? `<div id="${contextPanelId}" class="card-disclosure-panel source-context" data-panel-id="context" hidden><p>${escapeHtml(card.contextText)}</p></div>`
    : "";
  const isSelected = selectedCardIds.has(card.id);
  const selector = selectionMode
    ? `<label class="card-selector">
        <input data-action="select-card" data-id="${cardId}" type="checkbox" ${isSelected ? "checked" : ""}>
        <span class="sr-only">Select ${escapeHtml(card.selectedText)}</span>
      </label>`
    : "";

  return `
    <article class="phrase-card ${isKnown ? "is-known" : ""} ${isSelected ? "is-selected" : ""}" data-card-id="${cardId}">
      <div class="card-header">
        <div class="card-title-row">
          ${selector}
          <h2>${escapeHtml(card.selectedText)}</h2>
        </div>
        <span class="status-badge status-${statusClass}">${escapeHtml(status)}</span>
      </div>
      ${note}
      ${FEATURES.aiEnrichment && ai.summary ? `<p class="card-summary">${escapeHtml(ai.summary)}</p>` : ""}
      ${FEATURES.aiEnrichment && ai.contextMeaning ? `<p class="context-meaning">${escapeHtml(ai.contextMeaning)}</p>` : ""}
      ${tags}
      ${FEATURES.aiEnrichment && ai.error ? `<p class="error-text">${escapeHtml(ai.error)}</p>` : ""}
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
          ${FEATURES.aiEnrichment ? `<button data-action="enrich" data-id="${cardId}" type="button">Explain</button>` : ""}
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
          <span>Note</span>
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

function emptyState(query, selectedTag, selectedStatus) {
  const filtered = query || selectedTag || selectedStatus;
  return `
    <section class="empty-state">
      <h2>${filtered ? "No matches" : "Save what made you pause."}</h2>
      <p>${filtered ? "Try a broader search or clear a filter." : "Highlight text on a page, use your Phraselet shortcut, or right-click and choose Save to Phraselet."}</p>
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
  await saveCards(cards.map((card) => ({
    ...card,
    tags: normalizeTags(
      normalizeTags(card.tags)
        .map((tag) => normalizeTagKey(tag) === normalizeTagKey(currentTag) ? nextTag : tag)
    )
  })));
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
  await saveCards(cards.map((card) => ({
    ...card,
    tags: normalizeTags(card.tags)
      .filter((tag) => normalizeTagKey(tag) !== normalizeTagKey(currentTag))
  })));
  closeTagManager();
  showLibraryStatus(`Deleted tag ${currentTag}.`);
}

async function getCards() {
  const result = await chrome.storage.local.get(CARDS_KEY);
  return Array.isArray(result[CARDS_KEY]) ? result[CARDS_KEY] : [];
}

async function getBackupReminder() {
  const result = await chrome.storage.local.get(BACKUP_REMINDER_KEY);
  return normalizeBackupReminder(result[BACKUP_REMINDER_KEY]);
}

function normalizeBackupReminder(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return {
    lastBackupAt: typeof value.lastBackupAt === "string" ? value.lastBackupAt : "",
    snoozedUntil: typeof value.snoozedUntil === "string" ? value.snoozedUntil : ""
  };
}

function renderBackupReminder() {
  backupReminderEl.hidden = selectionMode || !shouldShowBackupReminder(cards, backupReminder);
}

async function markBackupCreated() {
  backupReminder = createBackupState();
  await chrome.storage.local.set({ [BACKUP_REMINDER_KEY]: backupReminder });
  renderBackupReminder();
}

async function snoozeBackupReminder() {
  try {
    backupReminder = createSnoozedBackupState(backupReminder);
    await chrome.storage.local.set({ [BACKUP_REMINDER_KEY]: backupReminder });
    renderBackupReminder();
    showLibraryStatus("Backup reminder snoozed for one week.");
  } catch {
    showLibraryStatus("Could not snooze the backup reminder.", true);
  }
}

async function upsertCard(card) {
  const nextCards = [
    card,
    ...cards.filter((candidate) => candidate.id !== card.id)
  ];
  await saveCards(nextCards);
}

async function deleteCard(id) {
  await saveCards(cards.filter((card) => card.id !== id));
}

function toggleExportMenu() {
  const shouldOpen = exportMenuEl.hidden;
  exportMenuEl.hidden = !shouldOpen;
  exportCardsEl.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    setTimeout(() => exportMenuEl.querySelector("button")?.focus(), 0);
  }
}

function closeExportMenu() {
  exportMenuEl.hidden = true;
  exportCardsEl.setAttribute("aria-expanded", "false");
}

function closeExportMenuFromOutside(event) {
  if (!exportMenuShellEl.contains(event.target)) {
    closeExportMenu();
  }
}

function closeExportMenuWithKeyboard(event) {
  if (event.key === "Escape" && !exportMenuEl.hidden) {
    closeExportMenu();
    exportCardsEl.focus();
  }
}

async function exportFromMenu(event) {
  const button = event.target.closest("button[data-export-format]");
  if (!button) {
    return;
  }

  closeExportMenu();
  await downloadCards(cards, button.dataset.exportFormat, {
    completeBackup: button.dataset.exportFormat === "json"
  });
}

async function exportSelectedPhrases() {
  const selectedCards = getSelectedCards();
  await downloadCards(selectedCards, bulkExportFormatEl.value, {
    completeBackup: bulkExportFormatEl.value === "json" && selectedCards.length === cards.length,
    selected: true
  });
}

async function copySelectedPhrases() {
  const selectedCards = getSelectedCards();
  const text = createPlainTextExport(selectedCards);
  if (!text) {
    showLibraryStatus("Select at least one phrase to copy.", true);
    return;
  }

  try {
    await writeClipboardText(text);
    showLibraryStatus(`Copied ${phraseCount(selectedCards.length)}.`);
  } catch {
    showLibraryStatus("Could not copy the selected phrases.", true);
  }
}

async function exportBackupNow() {
  backupNowEl.disabled = true;
  try {
    await downloadCards(cards, "json", { completeBackup: true });
  } finally {
    backupNowEl.disabled = false;
  }
}

async function downloadCards(cardList, format, { completeBackup = false, selected = false } = {}) {
  if (!cardList.length) {
    showLibraryStatus("No saved phrases to export.", true);
    return;
  }

  let file;
  try {
    file = createExportFile(cardList, format);
  } catch (error) {
    showLibraryStatus(error instanceof Error ? error.message : "Could not create the export.", true);
    return;
  }

  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `phraselet-${selected ? "selection" : "export"}-${dateStamp()}.${file.extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (completeBackup && format === "json") {
    await markBackupCreated().catch(() => undefined);
  }
  showLibraryStatus(`Exported ${phraseCount(cardList.length)} as ${file.label}.`);
}

function getSelectedCards() {
  return cards.filter((card) => selectedCardIds.has(card.id));
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Keep the user-initiated fallback below for older extension contexts.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard unavailable.");
  }
}

async function importCards() {
  const [file] = importFileEl.files;
  importFileEl.value = "";

  if (!file) {
    return;
  }

  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error("That file is larger than the 5 MB import limit.");
    }

    const payload = JSON.parse(await file.text());
    const importedCards = extractImportCards(payload);
    if (importedCards.length > MAX_IMPORT_CARDS) {
      throw new Error(`An import can contain at most ${MAX_IMPORT_CARDS} phrases.`);
    }
    const normalizedCards = collapseDuplicateCards(
      importedCards.map(normalizeImportedCard).filter(Boolean)
    );

    if (!normalizedCards.length) {
      showLibraryStatus("No valid Phraselet phrases found.", true);
      return;
    }

    const importResult = mergeImportedCards(normalizedCards, cards);
    if (importResult.cards.length > MAX_IMPORT_CARDS) {
      throw new Error(`Phraselet can store up to ${MAX_IMPORT_CARDS} phrases.`);
    }

    await saveCards(importResult.cards);
    await markBackupCreated().catch(() => undefined);
    showLibraryStatus(formatImportStatus(importResult));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "Import failed. Choose a valid Phraselet JSON file."
      : error instanceof Error ? error.message : "Import failed.";
    showLibraryStatus(message, true);
  }
}

async function saveCards(nextCards) {
  const byteLength = new TextEncoder().encode(JSON.stringify(nextCards)).byteLength;
  if (byteLength > MAX_LIBRARY_BYTES && byteLength >= libraryByteLength(cards)) {
    throw new Error("Phraselet's local library is full. Export or delete phrases before adding more.");
  }
  await chrome.storage.local.set({ [CARDS_KEY]: nextCards });
}

function libraryByteLength(cardList) {
  return new TextEncoder().encode(JSON.stringify(cardList)).byteLength;
}

function extractImportCards(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && ![1, IMPORT_SCHEMA_VERSION].includes(payload.schemaVersion)) {
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
    status: card.status === "known" ? "known" : "learning",
    note: cleanMultilineText(card.note, 2000),
    tags: normalizeTags(card.tags),
    ai: {
      status: ["enriched", "pending", "needs_api_key", "error", "not_requested"].includes(ai.status)
        ? ai.status
        : "pending",
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

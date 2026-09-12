export const EXPORT_SCHEMA_VERSION = 2;

const EXPORT_FORMATS = Object.freeze({
  json: {
    extension: "json",
    label: "JSON",
    mimeType: "application/json"
  },
  markdown: {
    extension: "md",
    label: "Markdown",
    mimeType: "text/markdown"
  },
  csv: {
    extension: "csv",
    label: "CSV",
    mimeType: "text/csv"
  }
});

export function createExportPayload(cards, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    cards: cards.map(serializeCard)
  };
}

export function createExportFile(cards, format, exportedAt = new Date().toISOString()) {
  const metadata = EXPORT_FORMATS[format];
  if (!metadata) {
    throw new Error("That export format is not supported.");
  }

  const content = {
    json: () => JSON.stringify(createExportPayload(cards, exportedAt), null, 2),
    markdown: () => createMarkdownExport(cards, exportedAt),
    csv: () => createCsvExport(cards)
  }[format]();

  return {
    ...metadata,
    content,
    mimeType: `${metadata.mimeType};charset=utf-8`
  };
}

export function createMarkdownExport(cards, exportedAt = new Date().toISOString()) {
  const lines = [
    "# Phraselet export",
    "",
    `Exported ${formatExportDate(exportedAt)} · ${cards.length === 1 ? "1 phrase" : `${cards.length} phrases`}`,
    ""
  ];

  cards.forEach((card, index) => {
    const enrichment = card.ai ?? card.enrichment ?? {};
    lines.push(`## Phrase ${index + 1}`, "", markdownQuote(card.selectedText), "");
    lines.push(`- Status: ${card.status === "known" ? "Known" : "Learning"}`);
    if (card.tags?.length) {
      lines.push(`- Tags: ${card.tags.map(escapeMarkdown).join(", ")}`);
    }
    if (card.createdAt) {
      lines.push(`- Saved: ${escapeMarkdown(card.createdAt)}`);
    }
    if (card.sourceTitle) {
      lines.push(`- Source: ${escapeMarkdown(card.sourceTitle)}`);
    }
    if (card.sourceUrl) {
      lines.push(`- URL: <${escapeMarkdownUrl(card.sourceUrl)}>`);
    }
    if (card.note) {
      lines.push("", "### Note", "", escapeMarkdown(card.note));
    }
    if (card.contextText) {
      lines.push("", "### Context", "", markdownQuote(card.contextText));
    }
    if (enrichment.summary) {
      lines.push("", "### Explanation", "", escapeMarkdown(enrichment.summary));
    }
    if (enrichment.contextMeaning) {
      lines.push("", "### Meaning in context", "", escapeMarkdown(enrichment.contextMeaning));
    }
    if (enrichment.examples?.length) {
      lines.push("", "### Examples", "", ...enrichment.examples.map((example) => `- ${escapeMarkdown(example)}`));
    }
    if (enrichment.relatedTerms?.length) {
      lines.push("", `Related terms: ${enrichment.relatedTerms.map(escapeMarkdown).join(", ")}`);
    }
    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

export function createCsvExport(cards) {
  const headings = [
    "phrase",
    "context",
    "source_title",
    "source_url",
    "note",
    "tags",
    "status",
    "created_at",
    "explanation",
    "meaning_in_context",
    "examples",
    "related_terms"
  ];
  const rows = cards.map((card) => {
    const enrichment = card.ai ?? card.enrichment ?? {};
    return [
      card.selectedText,
      card.contextText,
      card.sourceTitle,
      card.sourceUrl,
      card.note,
      Array.isArray(card.tags) ? card.tags.join("; ") : "",
      card.status === "known" ? "known" : "learning",
      card.createdAt,
      enrichment.summary,
      enrichment.contextMeaning,
      Array.isArray(enrichment.examples) ? enrichment.examples.join(" | ") : "",
      Array.isArray(enrichment.relatedTerms) ? enrichment.relatedTerms.join("; ") : ""
    ].map(csvCell).join(",");
  });

  return `\uFEFF${[headings.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
}

export function createPlainTextExport(cards) {
  return cards
    .map((card) => String(card.selectedText ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function serializeCard(card) {
  const { ai, ...baseCard } = card;
  const hasEnrichment = ai && (
    ai.summary
    || ai.contextMeaning
    || ai.examples?.length
    || ai.relatedTerms?.length
  );

  return hasEnrichment
    ? { ...baseCard, enrichment: ai }
    : baseCard;
}

function formatExportDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function markdownQuote(value) {
  return escapeMarkdown(value)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeMarkdown(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([`*_\[\]])/g, "\\$1");
}

function escapeMarkdownUrl(value) {
  return String(value ?? "")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll(" ", "%20");
}

function csvCell(value) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n");
  const spreadsheetSafe = /^[\t\n ]*[=+\-@]/.test(normalized)
    ? `'${normalized}`
    : normalized;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

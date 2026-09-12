export const EXPORT_SCHEMA_VERSION = 2;

export function createExportPayload(cards, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    cards: cards.map(serializeCard)
  };
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

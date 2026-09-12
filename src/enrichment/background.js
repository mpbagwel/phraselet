import { requestExplanation } from "./openai.js";

export function createEnrichmentRuntime({ getCards, getSettings, patchCard }) {
  return { enrichCard };

  async function enrichCard(cardId) {
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
            ? "Add an OpenAI API key in Settings to generate a context-specific explanation."
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
}

function hasSameExplanationInput(left, right) {
  return cleanText(left?.selectedText) === cleanText(right?.selectedText)
    && cleanText(left?.contextText) === cleanText(right?.contextText);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fallbackDefinition(phrase) {
  return `Saved "${phrase}". AI enrichment is ready once an API key is configured.`;
}

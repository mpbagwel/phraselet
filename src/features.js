export const FEATURES = Object.freeze({
  aiEnrichment: false
});

export async function loadEnrichmentProvider() {
  if (!FEATURES.aiEnrichment) {
    return null;
  }

  return import("./enrichment/openai.js");
}

export async function loadEnrichmentOptions() {
  if (!FEATURES.aiEnrichment) {
    return null;
  }

  return import("./enrichment/options.js");
}

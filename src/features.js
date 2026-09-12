export const FEATURES = Object.freeze({
  aiEnrichment: false
});

export async function loadEnrichmentRuntime() {
  if (!FEATURES.aiEnrichment) {
    return null;
  }

  return import("./enrichment/background.js");
}

export async function loadEnrichmentOptions() {
  if (!FEATURES.aiEnrichment) {
    return null;
  }

  return import("./enrichment/options.js");
}

export async function loadEnrichmentOnboarding() {
  if (!FEATURES.aiEnrichment) {
    return null;
  }

  return import("./enrichment/onboarding.js");
}

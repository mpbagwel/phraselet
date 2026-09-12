export function applyEnrichmentOnboardingCopy() {
  document.querySelector("#onboarding-third-title").textContent = "Explain when you want";
  document.querySelector("#onboarding-third-copy").textContent = "AI explanations are optional. Add your own OpenAI API key in Settings if you want contextual definitions and examples.";
  document.querySelector("#privacy-title").textContent = "Your data and AI";
  document.querySelector("#privacy-copy").textContent = "Saved phrases, nearby context, page titles, URLs, notes, tags, and your optional API key are stored in Chrome on this device. When AI explanations are enabled, the phrase, nearby context, page title, and site hostname are sent to OpenAI without asking OpenAI to retain the generated response.";
}

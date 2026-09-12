# Phraselet AI Development Build Privacy Notes

Last updated: September 12, 2026

This document applies only to Phraselet's internal AI development build. It does not apply to the public Chrome Web Store release described in `PRIVACY.md`.

The AI development build stores the same local phrase-library information as the public build, plus an optional OpenAI API key and generated explanations. The API key is stored in Chrome's local extension storage on the device.

When AI explanations are enabled, the extension sends the saved phrase, nearby context, source title, and source-site hostname directly to OpenAI's API. It does not send the full source URL, notes, tags, the complete phrase library, or unrelated browsing history. Requests specify that the generated response should not be stored for later retrieval.

OpenAI processes submitted data under its applicable terms and privacy policies. Users can remove the stored API key in Settings and can delete generated explanations by deleting the associated phrase or clearing the extension's local storage.

Questions about this development build can be sent to [mpbagwell.dev@gmail.com](mailto:mpbagwell.dev@gmail.com).

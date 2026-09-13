# Phraselet Release Checklist

## Required before Chrome Web Store submission

- [x] Set the publisher name to Phraselet and the support contact to `mpbagwell.dev@gmail.com`.
- [x] Publish `PRIVACY.md` at a stable public URL and add that URL to the store listing.
- [x] Confirm the upload is the base artifact and contains no AI provider or third-party host permission.
- [ ] Complete Chrome Web Store privacy disclosures for locally saved content and gesture-scoped page access.
- [x] Prepare store copy and permission explanations in `STORE_LISTING.md`.
- [x] Supply at least one full-bleed 1280×800 or 640×400 screenshot.
- [x] Supply a 440×280 small promotional image.
- [x] Verify the 128×128 store icon uses a 96×96 mark with 16 pixels of transparent padding.
- [ ] Test a clean install and update on the oldest supported Chrome version and current stable Chrome.
- [ ] Verify capture on ordinary pages, iframes, text inputs, and protected Chrome pages (which should fail gracefully).
- [ ] Verify JSON import, JSON/Markdown/CSV export, selected-phrase copy/export, backup reminders, current/archived views, bulk actions, onboarding, and keyboard shortcuts.
- [ ] Run `npm run check` from a clean checkout.
- [x] Run `npm run package:base` and inspect the generated ZIP before upload.
- [ ] Increment `version` in both `manifest.json` and `package.json` for every upload.

## Store positioning

Single purpose: Save and organize selected words and phrases from webpages with their source context.

Suggested category: Education.

Permission explanations:

- `activeTab`: Temporarily access the active page only after the user invokes Phraselet.
- `scripting`: Read the current selection and nearby context after that user action, including on tabs that were already open when the extension was installed or updated.
- `contextMenus`: Add the **Save to Phraselet** action to Chrome's selection context menu.
- `storage`: Keep the phrase library and preferences locally in Chrome.

## Release package

`npm run package:base` creates `dist/phraselet-base-<version>.zip` with only these runtime files and directories. `npm run package:ai-dev` creates a separate internal build with the enrichment provider and OpenAI host permission.

- `manifest.json`
- `popup.html`, `options.html`, and `onboarding.html`
- `src/`
- `assets/`

Exclude tests, repository metadata, documentation, and local development files.

## September 13, 2026 hardening run

- All 29 automated checks passed.
- `dist/phraselet-base-0.1.0.zip` contains no enrichment modules, provider references, or third-party host permission.
- `dist/phraselet-ai-dev-0.1.0.zip` contains the optional enrichment modules and OpenAI host permission as an internal-only build.
- Store screenshots are 1280×800, the promotional image is 440×280, and the store icon is 128×128 with a centered 96×96 mark.
- The public site, privacy policy, and support page are published at `https://phraselet-cards.dreamingbigdreams.chatgpt.site`.

## Portability behavior

- JSON is the lossless, restorable backup format.
- Markdown and CSV are portable export formats and are not imported back into Phraselet.
- Bulk-selection mode can copy phrase text or export the selected records only.
- Libraries with at least 10 phrases receive a reminder after 30 days without a complete JSON backup; **Later** snoozes it for seven days.

## Library lifecycle

- New and previously learning phrases appear in the **Current** view.
- Previously known phrases migrate to **Archived** so existing organization is preserved.
- Users can archive and restore individual cards or a bulk selection without deleting them.
- Complete backups include both current and archived cards; schema versions 1 and 2 remain importable.

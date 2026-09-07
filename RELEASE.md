# Phraselet Release Checklist

## Required before Chrome Web Store submission

- [ ] Replace the draft privacy-policy contact note with the publisher's support email or website.
- [ ] Publish `PRIVACY.md` at a stable public URL and add that URL to the store listing.
- [ ] Confirm the upload is the base artifact and contains no AI provider or third-party host permission.
- [ ] Complete Chrome Web Store privacy disclosures for locally saved content and gesture-scoped page access.
- [ ] Prepare store copy, screenshots, a 1280×800 promotional image if desired, and support information.
- [ ] Test a clean install and update on the oldest supported Chrome version and current stable Chrome.
- [ ] Verify capture on ordinary pages, iframes, text inputs, and protected Chrome pages (which should fail gracefully).
- [ ] Verify import/export, bulk actions, onboarding, and keyboard shortcuts.
- [ ] Run `npm run check` from a clean checkout.
- [ ] Run `npm run package:base` and inspect the generated ZIP before upload.
- [ ] Increment `version` in both `manifest.json` and `package.json` for every upload.

## Release package

`npm run package:base` creates `dist/phraselet-base-<version>.zip` with only these runtime files and directories. `npm run package:ai-dev` creates a separate internal build with the enrichment provider and OpenAI host permission.

- `manifest.json`
- `popup.html`, `options.html`, and `onboarding.html`
- `src/`
- `assets/`

Exclude tests, repository metadata, documentation, and local development files.

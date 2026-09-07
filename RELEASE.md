# Pausemark Release Checklist

## Required before Chrome Web Store submission

- [ ] Replace the draft privacy-policy contact note with the publisher's support email or website.
- [ ] Publish `PRIVACY.md` at a stable public URL and add that URL to the store listing.
- [ ] Decide whether the public product remains bring-your-own-key or moves OpenAI requests behind a service. Never ship a publisher API key in the extension.
- [ ] Complete Chrome Web Store privacy disclosures for local saved content and optional OpenAI processing.
- [ ] Prepare store copy, screenshots, a 1280×800 promotional image if desired, and support information.
- [ ] Test a clean install and update on the oldest supported Chrome version and current stable Chrome.
- [ ] Verify capture on ordinary pages, iframes, text inputs, and protected Chrome pages (which should fail gracefully).
- [ ] Verify import/export, bulk actions, onboarding, keyboard shortcuts, and AI error states.
- [ ] Run `npm run check` from a clean checkout.
- [ ] Run `npm run package` and inspect the generated ZIP before upload.
- [ ] Increment `version` in both `manifest.json` and `package.json` for every upload.

## Release package

`npm run package` creates `dist/pausemark-<version>.zip` with only these runtime files and directories:

- `manifest.json`
- `popup.html`, `options.html`, and `onboarding.html`
- `src/`
- `assets/`

Exclude tests, repository metadata, documentation, and local development files.

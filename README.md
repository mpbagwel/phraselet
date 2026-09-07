# Pausemark Chrome Extension

Pausemark is a first-pass Chrome extension for saving words and phrases as you encounter them online. It captures the selected text, source URL, page title, surrounding context, and an optional AI explanation.

## Install locally

1. Open Chrome and visit `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.

## Use it

1. Highlight a word or phrase on any webpage.
2. Press `Alt+Shift+S` (`Option+Shift+S` on macOS) or right-click and choose **Save to Pausemark**.
3. Open the extension popup to review saved cards.
4. Optional: open extension options and add an OpenAI API key to generate richer explanations.

Cards are stored in `chrome.storage.local` on your machine. Pausemark accesses page content only when you invoke a save action; it does not install a persistent script on every site.

## Current MVP

- Context-menu capture for highlighted text
- Source title, URL, and nearby context capture
- Duplicate-aware capture and import
- Local card library with editable notes, tags, filtering, and related phrases
- Bulk selection for tagging, status changes, and deletion
- Tag autocomplete, rename, and delete controls
- JSON import/export for backing up or moving saved phrases
- Configurable confirmation or popup after saving
- Optional OpenAI enrichment through the Responses API
- First-install welcome guide with capture and data-handling details
- Gesture-scoped page access, bounded capture/import data, and restricted extension storage
- No backend service required

## Development checks

Run `npm run check` to syntax-check the extension scripts and execute the automated tests. The same command runs in GitHub Actions. Run `npm run package` to create a store-ready ZIP in `dist/` containing runtime files only.

See `RELEASE.md` for the store-submission checklist and `PRIVACY.md` for the draft privacy policy.

## Possible post-release additions

- Add collections
- Add a side panel reading companion
- Sync cards across browsers

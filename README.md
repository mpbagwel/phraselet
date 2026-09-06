# Pausemark Chrome Extension

Pausemark is a first-pass Chrome extension for saving words and phrases as you encounter them online. It captures the selected text, source URL, page title, surrounding context, and an optional AI explanation.

## Install locally

1. Open Chrome and visit `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `chrome-extension`.

## Use it

1. Highlight a word or phrase on any webpage.
2. Press `Alt+Shift+S` (`Option+Shift+S` on macOS) or right-click and choose **Save to Pausemark**.
3. Open the extension popup to review saved cards.
4. Optional: open extension options and add an OpenAI API key to generate richer explanations.

Cards are stored in `chrome.storage.local` on your machine.

## Current MVP

- Context-menu capture for highlighted text
- Source title, URL, and nearby context capture
- Local card library with search, tags, filtering, delete, and known/learning status
- JSON import/export for backing up or moving saved phrases
- Configurable confirmation or popup after saving
- Optional OpenAI enrichment through the Responses API
- No backend service required

## Next useful steps

- Add spaced repetition review
- Add collections
- Add a side panel reading companion
- Sync cards across browsers

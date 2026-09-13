# Phraselet for Chrome on macOS

Phraselet is a macOS-first, local-first Chrome extension for saving words and phrases as you encounter them online. It captures the selected text, source URL, page title, and surrounding context for later organization and review. Windows and Linux are supported too.

## Install on macOS

1. In Chrome, visit `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.

## Use it

1. Highlight a word or phrase on any webpage.
2. Press `Option+Shift+P` or right-click and choose **Save to Phraselet**. You can change the shortcut from Settings. On Windows and Linux, the default is `Alt+Shift+P`.
3. Open the extension popup to review saved cards.

Selections over 500 characters are shortened at the nearest word boundary before they are saved.

Cards are stored in `chrome.storage.local` on your machine. Phraselet accesses page content only when you invoke a save action; it does not install a persistent script on every site.

## Public Base build

- Context-menu capture for highlighted text
- Source title, URL, and nearby context capture
- Duplicate-aware capture and import
- Local card library with editable notes, tags, filtering, and related phrases
- A Current default view plus Archived and All cards views
- Single-card and bulk archive/restore controls; older Learning and Known states migrate to Current and Archived
- Bulk selection for tagging, archiving, export, copy, and deletion
- Tag autocomplete, rename, and delete controls
- Restorable, versioned JSON backups plus export-only Markdown and CSV formats
- Copy or export only the phrases selected in bulk mode
- A quiet backup reminder when a library of at least 10 phrases goes 30 days without a complete JSON backup; **Later** snoozes it for seven days
- Configurable confirmation or popup after saving
- First-install welcome guide with capture and data-handling details
- Gesture-scoped page access, bounded capture/import data, and restricted extension storage
- No backend service required

JSON is the lossless backup format and Phraselet accepts compatible schema versions 1 through 3. Markdown and CSV are intended for notes apps, text editors, and spreadsheets; they are not imported back into Phraselet.

## Build targets

The source tree defaults to the Base feature configuration. `npm run package:base` creates the local-first Chrome Web Store ZIP without AI provider code, API-key controls, third-party host access, or a standing clipboard permission.

`npm run package:ai-dev` creates a separate internal build that adds its enrichment interface, provider modules, API-key settings, and OpenAI host permission during packaging. It is an experimental development artifact, not a publicly supported edition or store-submission package.

## Development checks

Run `npm run check` to syntax-check the extension scripts and execute the automated tests. The same command runs in GitHub Actions. The September 13, 2026 hardening run passed all 29 checks and rebuilt both package targets.

## Project documents

- [`PRODUCT.md`](PRODUCT.md) defines the product direction, release scope, and Base/AI boundary.
- [`RELEASE.md`](RELEASE.md) tracks the Chrome Web Store submission checklist and manual testing still required.
- [`STORE_LISTING.md`](STORE_LISTING.md) contains the prepared listing copy and permission disclosures.
- [`PRIVACY.md`](PRIVACY.md) is the policy for the public Base build; [`PRIVACY-AI.md`](PRIVACY-AI.md) covers the internal AI development path.

The [Phraselet website](https://phraselet-cards.dreamingbigdreams.chatgpt.site) hosts the public [privacy policy](https://phraselet-cards.dreamingbigdreams.chatgpt.site/privacy/) and [support page](https://phraselet-cards.dreamingbigdreams.chatgpt.site/support/).

## Possible post-release additions

- Add collections
- Add a side panel reading companion
- Sync cards across browsers

## License

Phraselet is available under the [MIT License](LICENSE).

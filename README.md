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

## Current MVP

- Context-menu capture for highlighted text
- Source title, URL, and nearby context capture
- Duplicate-aware capture and import
- Local card library with editable notes, tags, filtering, and related phrases
- Bulk selection for tagging, status changes, and deletion
- Tag autocomplete, rename, and delete controls
- JSON import/export for backing up or moving saved phrases
- Configurable confirmation or popup after saving
- First-install welcome guide with capture and data-handling details
- Gesture-scoped page access, bounded capture/import data, and restricted extension storage
- No backend service required

## Development checks

Run `npm run check` to syntax-check the extension scripts and execute the automated tests. The same command runs in GitHub Actions. Run `npm run package:base` to create the local-first store ZIP or `npm run package:ai-dev` to create the internal AI-enabled build.

The source tree defaults to the base feature configuration. The AI development build adds its provider, settings interface, and OpenAI host permission only during packaging; it is not intended for store submission.

See `RELEASE.md` for the store-submission checklist. The [Phraselet website](https://phraselet-cards.dreamingbigdreams.chatgpt.site) includes the public [privacy policy](https://phraselet-cards.dreamingbigdreams.chatgpt.site/privacy/) and [support page](https://phraselet-cards.dreamingbigdreams.chatgpt.site/support/); `PRIVACY.md` is the source policy kept with the extension.

## Possible post-release additions

- Add collections
- Add a side panel reading companion
- Sync cards across browsers

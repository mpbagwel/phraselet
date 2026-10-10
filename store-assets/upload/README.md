# Chrome Web Store upload assets

Upload the individual image files to the matching fields in **Store listing → Graphic assets**.

| Dashboard field | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128x128.png` | 128 × 128 |
| Screenshots | `capture-1280x800.jpg` | 1280 × 800 |
| Screenshots | `library-1280x800.jpg` | 1280 × 800 |
| Screenshots | `bulk-actions-1280x800.jpg` | 1280 × 800 |
| Screenshots | `portability-1280x800.jpg` | 1280 × 800 |
| Small promo tile | `small-promo-440x280.jpg` | 440 × 280 |

Use all four screenshots, with the library screenshot first to show the interface immediately. At least one screenshot is required. The optional marquee tile and promotional video are not included.

The four screenshots reflect Phraselet 0.1.2. Library, bulk actions, and portability use the actual popup HTML, JavaScript, and styles with seeded example cards and a mocked Chrome API. The capture image uses the shipping confirmation toast and shows Option+Shift+P. Browser framing and the capture webpage are staged illustrations, not screenshots of a user's live browser.

Screenshot masters in `../screenshots/` are PNG; upload screenshots are JPEG without alpha. The PNG icon retains its transparent padding. The promo tile and store icon are unchanged.

The four screenshots were refreshed, checked at 1280 × 800, and visually reviewed on October 9, 2026.

To regenerate them from the current popup, provide the optional `playwright` and `sharp` Node modules and a Playwright Chromium installation, then run `node scripts/render-store-screenshots.cjs` from the repository root. This also updates the standalone HTML previews in `../source/` and the README's `phraselet-capture.jpg` mirror. The generator does not change extension data or publish assets.

Requirements: [Chrome Web Store image guidance](https://developer.chrome.com/docs/webstore/images).

The extension package is uploaded separately from these listing images: `dist/phraselet-base-0.1.2.zip`.

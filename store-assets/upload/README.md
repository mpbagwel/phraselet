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

These files reuse the existing Phraselet branding and staged product illustrations in `store-assets/`; they are not new live Chrome captures. Screenshot and promo filenames now use `.jpg` to match their actual JPEG encoding. They have no alpha channel. The PNG icon retains its transparent padding.

Dimensions, image formats, and alpha channels were checked on September 17, 2026, and every image was visually reviewed.

Requirements: [Chrome Web Store image guidance](https://developer.chrome.com/docs/webstore/images).

The extension package is uploaded separately from these listing images: `dist/phraselet-base-0.1.0.zip`.

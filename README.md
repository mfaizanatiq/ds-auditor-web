# DS Auditor for Web

Chrome extension that audits live web pages against your design system token libraries. Upload CSS or JSON token files, run an audit on the active tab, and get a compliance report with smart fixes for typography, spacing, colors, shadows, and border radius.

Companion to the [DS Auditor Figma plugin](https://github.com/faizanatiq/ds-auditor) — same design language, adapted for the DOM.

## Features

- **Multiple token libraries** — upload `.css`, `.scss`, or `.json` files; enable/disable per library
- **CSS custom properties** — parses `--token-name` declarations from uploaded stylesheets
- **JSON tokens** — supports Style Dictionary / Tokens Studio style nested JSON (`$value`, `$type`)
- **Page audit** — scans visible DOM elements for hardcoded values vs token usage
- **Smart fixes** — suggests nearest matching tokens (same heuristics as the Figma plugin)
- **Categories** — color, typography, spacing, shadows/effects, border radius
- **Compliance score** — percentage based on issue count
- **Highlight on click** — click an issue to scroll to and outline the element on the page
- **Export** — download full report as JSON

## Install (developer mode)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `ds-auditor-web`

## Preloaded tokens

**FDS Light** (`variables-light.css` from `fds-design-tokens`) is bundled automatically on install. No upload required.

To refresh after updating the source CSS:

```bash
cp ../fds-design-tokens/build/css/variables-light.css data/fds-variables-light.css
node scripts/bundle-preload.js
```

Then reload the extension in `chrome://extensions`.

## Quick start

1. Click the DS Auditor icon in the toolbar
2. Navigate to any website (FDS Light tokens are already loaded)
3. Click **Audit this page**
4. Optionally open **Settings** (gear) to add more CSS / JSON libraries
5. Review issues, filter by type, click cards to highlight elements
6. **Export report (JSON)** for sharing or CI integration

## Token file formats

### CSS

```css
:root {
  --color-brand-primary: #0d99ff;
  --space-4: 16px;
  --font-size-body: 16px;
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

### JSON (nested)

```json
{
  "color": {
    "brand": {
      "primary": { "$value": "#0d99ff", "$type": "color" }
    }
  },
  "space": {
    "4": { "$value": "16px", "$type": "dimension" }
  }
}
```

## Architecture

```
ds-auditor-web/
├── manifest.json          # MV3 extension manifest
├── background/            # Service worker (storage, tab messaging)
├── content/               # DOM scanner + element highlight
├── lib/
│   ├── color-utils.js     # Color parse/compare
│   ├── token-parser.js    # CSS/JSON → token list
│   ├── token-engine.js    # Token matching heuristics
│   └── auditor.js         # DOM walk + issue generation
├── popup/                 # Extension UI (libraries + report)
└── samples/               # Example token file
```

## What gets flagged

| Category    | Properties checked                          | Compliant when        |
|-------------|---------------------------------------------|------------------------|
| Color       | `color`, `background-color`, `border-color` | Uses `var(--token)` from library |
| Typography  | `font-size`, `font-family`                  | Matches typography tokens |
| Spacing     | margin, padding, gap                        | Matches spacing tokens |
| Shadow      | `box-shadow`                                | Matches shadow tokens |
| Radius      | `border-radius`                             | Matches radius tokens |

Hardcoded pixel/hex values that match a token in your library are flagged with suggested `var(--token-name)` fixes.

## Limitations (v0.1)

- Audits **computed styles** on visible elements (max ~2500 nodes per run)
- Cannot auto-apply fixes to live sites (read-only audit; fixes are suggestions)
- `chrome://` and extension pages cannot be audited
- Typography matching is heuristic (font-size/family); full composite text styles coming later

## License

MIT

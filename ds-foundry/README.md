# DS Foundry 1.4.0

A Figma plugin that reads any file (or app, or selection), labels and tags its layers, and builds a design system from what it finds: colour, text and effect styles; a variables collection; component sets sampled from real buttons, inputs, cards and nav bars; an icon library; documented foundation pages; and token files ready for code.

Nothing in the file changes until you press **Build**. Labels are reversible.

## Install (development plugin, no build step needed)

1. Unzip. `dist/` already contains the compiled plugin.
2. In the Figma desktop app: **Plugins → Development → Import plugin from manifest…**
3. Pick `manifest.json` from this folder.
4. Open any file and run **Plugins → Development → DS Foundry**.

## Use

1. Choose a scope — **Selection**, **Page** or **Document** — and press **Scan**.
   The inventory shows everything found: colours (with proposed names), text styles, spacing scale, radii, effects, recognised elements, icons, and components already in use.
2. Set the **prefix** (default `ds/`) and the **grid** spacing snaps to (4 or 8).
3. Tick what to build and press **Build design system**.
4. Download the token files: `tokens.json` (W3C DTCG), `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, `inventory.json`, or all of them as one zip.

Re-running Build replaces the pages it generated and updates styles and variables in place, so you can scan → tweak → rebuild without duplicates. **Revert labels** restores every original layer name.

## AI naming (optional)

Heuristic labels tell you *what kind* of thing a layer is. AI naming tells you *what it shows*: `ds/icon/arrow-left` instead of `ds/icon/vector-14`, `ds/screen/checkout-summary` instead of `ds/screen/frame-3`, `ds/image/mountain-lake-hero`, `ds/card/pricing-plan-pro`, `ds/primary-button` for a component.

1. Scan, then pick a provider in the **AI naming** section — **Claude** (Anthropic API key) or **Gemini** (Google AI Studio key) — and paste the key. Keys are saved in Figma's client storage on this machine only and sent straight to that provider — nothing goes anywhere else.
2. Pick a model and tick what to name: icons, images and avatars, screens/sections/nav, cards and list items, local components, plain shapes.
   - Claude: Sonnet 5 (default), Haiku 4.5 (cheapest), Opus 5.
   - Gemini: 3.7 Flash (default), 3.8 Flash, 3.5 Flash-Lite (cheapest), 3.1 Pro preview.
   - **Custom model ID…** lets you type any model ID either provider offers, so new releases work without a plugin update.
   - **Proxy (LangGraph server)** sends batches to the companion `ds-foundry-server` on `http://localhost:8000` instead. That adds a critic pass, a per-project glossary that keeps names consistent across files, and a cache, and lets you route to Claude, Gemini or a local Ollama model from one place. Each review row then shows its source (`model`, `critic`, `glossary`, `cache`) and confidence. Localhost access is allowed via `devAllowedDomains` in the manifest, which Figma honours for development plugins. Keep the server on `localhost` (not `127.0.0.1`) — Figma's manifest validator only accepts domain and localhost patterns.
3. **Suggest names** exports a small thumbnail of each distinct item (identical layers are grouped by fingerprint and named once), composites it on white, and sends batches of 10 images per request, three requests at a time. Each item comes back with a name and a five-word description.
4. Review the list — edit any name inline, untick anything you don't want — then **Apply names**. Original names are stored, so **Revert labels** undoes this too.

Variants inside a component set are never renamed (that would rewrite their properties); the set itself is. With **Add prefix and category path** on, names become `ds/<category>/<name>`; off, the bare name is used.

Cost is small: thumbnails are capped at 384 px, so a 300-item run is roughly 300 images and 30 short requests. Both providers are called directly from the plugin panel (Claude with the `anthropic-dangerous-direct-browser-access` header, Gemini via `generateContent` in JSON mode). To route through your own proxy instead, change `CLAUDE_URL` / `GEMINI_URL` in `ui/ui.html` and the domains in `manifest.json`.

## Assets: every vector named, nothing left as "Vector 123"

The scan sorts drawn things into tiers by geometry, and every one gets a name even before AI runs:

| Class | How it's recognised | Fallback name |
|---|---|---|
| **icon** | vector-only, ≤ 64 px, roughly square | `ds/icon/<layer-name>` |
| **symbol** | vector-only, 64–200 px, few pieces (ornaments, marks, single big paths) | `ds/symbol/navy-outline-160x120` |
| **illustration** | vector-only, > 200 px or many pieces (scenes, objects, drawn figures) | `ds/illustration/navy-14-piece-250x270` |
| **logo** | wide vector lockup with several pieces, a vector mark + text, or "logo/wordmark/brand" in the name | `ds/logo/<wordmark-text>` |
| **character** | assigned by AI naming when the picture has a face, body or pose | `ds/character/owl-mascot` |
| **tagline** | short multi-word text, 14–34 px, no terminal punctuation | `ds/tagline/<words>` |
| **copy** | text over 90 chars or more than two lines | `ds/copy/<first-words>` |
| **shape** | plain rect/ellipse/line/polygon/star or leftover path | `ds/shape/navy-pill-120x40`, `ds/shape/cyan-blob-56x30` |
| **debris** | specks under 6 px, empty paths, invisible or zero-opacity fragments | `ds/debris/black-speck-3x2` |

Geometry names read colour + form + size: `pale-blue-blob`, `navy-outline-curve`, `orange-circle`, `white-rounded-rect`, `gray-line`. Figma's auto names (Vector 12, Group 7) are treated as meaningless and replaced; a name you gave a layer is kept.

**Debris** is listed on the contact sheet and, in the plugin's Elements tab, **Select on page** selects every debris layer on the current page so you can delete it in one keystroke.

**AI naming** now also returns a `kind` for each item and may reclassify — a "symbol" that is clearly a mascot becomes a `character`, an "illustration" that is a wordmark becomes a `logo`. Two more behaviours:

- **Too abstract → you name it.** The model is told to answer `abstract` instead of guessing. Those rows appear first in the review list, highlighted, with an empty box; type a name and it's applied with the rest.
- **Other views of a character.** Characters and logos named with ≥ 80% confidence become references. Low-confidence characters, illustrations and symbols get a second look with those references attached, so the back of the owl becomes `owl-mascot-back` rather than "green-bird-shape". In Proxy mode the server keeps references (with thumbnails) per project, so the next file recognises the mascot on the first pass.

**Assets contact sheet** (`DS · Assets`, on by default) lays all of this out on one page: an index, then Logos, Characters, Illustrations, Symbols & ornaments, Icons, Buttons & badges, Taglines, Copy, Vectors & shapes, Debris — one cell per distinct thing (identical layers collapse with a ×count), each vector-class cell promoted to a component carrying its name. Run AI naming and apply before building it and the sheet uses those names and reclassifications.

## What gets built

| Option | Result |
|---|---|
| Label layers | Every recognised element gets tagged with its category in plugin data and, if *Rename* is on, renamed to a searchable path such as `ds/button/primary-md/sign-up`, `ds/card/pricing`, `ds/icon/arrow-left`, `ds/screen/home`. Original names are stored so they can be restored. Text layers are optional (renaming them turns off Figma's auto-naming). |
| Styles | Local colour styles (`ds/color/primary/500`), text styles (`ds/text/heading/lg/semibold`) and effect styles (`ds/effect/elevation/2`). Colour styles are bound to variables when a variable was created. |
| Variables | A `DS Foundry / Primitives` collection with `color/…`, `space/…` and `radius/…` variables, scoped appropriately. Falls back gracefully on plans with variable limits. |
| Foundations page | `DS · Foundations` — swatch boards grouped by role, type specimens using the real styles, spacing bars, radius tiles and elevation cards. |
| Components page | `DS · Components` — for each category (button, input, badge, checkbox, toggle, avatar, list item, card, nav, section) distinct instances are cloned, promoted to components and combined into a variant set named `ds/button`, with `Style` and `Size` properties. A gallery of components already used in the file is placed below. Originals are never modified. |
| Icons page | `DS · Icons` — every unique icon-like vector is centred on a square frame and made a component named `ds/icon/<name>`. |
| Assets contact sheet | `DS · Assets` — see the Assets section above. |
| Arrange screens | Optional: top-level frames on the scanned pages are lined up in rows by device width (mobile / tablet / desktop). Off by default because it moves things. |

## How it decides what things are

Classification is heuristic and needs no naming conventions in the source file:

- **Colour roles** — greys become `neutral` (white = `neutral/0`, black = `neutral/1000`). The most-used chromatic hue family becomes `primary`, the next `secondary`; remaining families map to `error` (red), `success` (green), `warning` (yellow/orange), `info` (blue) or their hue name. Within a family the most-used colour anchors at `500` and the rest spread by lightness.
- **Typography** — unique combinations of font, style, size, line height and letter spacing. Roles by size: `display` ≥ 40, `heading` ≥ 24, `title` ≥ 18, `body` ≥ 14, `caption` below. Sizes inside a role get `xl/lg/md/sm/xs`; weight from the font style.
- **Spacing** — auto-layout padding and gaps, snapped to the chosen grid. **Radius** — corner radii, `full` for pill shapes. **Effects** — shadows ranked by depth as `elevation/n`, blurs as `blur/n`.
- **Elements** — buttons are compact containers with one short text and a fill or stroke; inputs are light, stroked and wide with placeholder-coloured text; badges are ≤ 28px tall; cards are surfaced containers with several children; nav bars are wide, short and near the top of their parent; icons are vector-only subtrees ≤ 64px; avatars are round image fills; screens are top-level frames ≥ 300px.

Instances of existing components are inventoried but never renamed or re-componentised.

## Develop

```bash
npm install
npm run check      # typecheck + build → dist/
npm run watch      # rebuild code.js on change (copy ui.html with `node tools/copy-ui.mjs`)
```

- `src/scan.ts` — walks the document and collects the inventory
- `src/classify.ts` — element heuristics
- `src/naming.ts` — token and label naming
- `src/build.ts` — styles, variables, pages, components, icons, tidy
- `src/tokens.ts` — DTCG / CSS / Tailwind / Markdown exports
- `src/ai.ts` — AI naming: candidate selection, thumbnail export, applying names
- `ui/ui.html` — the panel (single file; copied to `dist/`), including the Claude API client for AI naming

## Known limits

- Gradients and image fills are not tokenised (solid fills and strokes only).
- Text styles for fonts not installed on the machine are skipped and listed in the notes.
- Variant sets sample up to 14 distinct buttons / badges, 8 inputs / cards, 4 nav bars; icons up to 240. Raise the limits in `src/build.ts` if needed.
- Generated pages are placed from `(0, 0)`; if you already have a page named `DS · Foundations`, `DS · Components` or `DS · Icons`, only frames the plugin created are replaced.
- Very large documents: scanning a whole file with tens of thousands of layers takes a while; the panel stays responsive and **Stop** works at any time.

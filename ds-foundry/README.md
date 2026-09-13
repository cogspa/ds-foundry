# DS Foundry 1.5.0

A Figma plugin that reads any file (or app, or selection), labels and tags its layers, and builds a design system from what it finds: colour, text and effect styles; a variables collection; component sets sampled from real buttons, inputs, cards and nav bars; an icon library; documented foundation pages; and token files ready for code.

Scanning and canonical resolution are read-only. Build, Apply names and Apply approved are explicit write actions. Labels are reversible.

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
| **logo** | explicit logo/wordmark/logotype name or reviewed semantic classification; UI exclusions take precedence | `ds/logo/<wordmark-text>` |
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

## Canonical Asset Resolution

Canonical families now separate identity from color, orientation, treatment and lockup. Scan → optional AI names → **Canonical Assets / Resolve assets** → review and confirm → **Apply approved** → export `asset-map.json`. Project references remember approved identities across files. Layout metadata is retained for future work; no recomposition solver is included.

See [workflow, API, architecture, limits and tests](../CANONICAL_ASSETS.md). Existing naming and build behavior remains available.

### Named contact sheets
Scan the original artwork, choose **Identify & suggest names**, review the names and corrected classes, then click **Apply names & build sheets**. This uses the configured vision provider and builds Components, Icons, and Assets sheets after the names have been applied successfully. The Assets sheet includes logos, icons, symbols, component artwork, and visual previews of possible vector debris. Unrecognized artwork is marked **Needs identification** rather than given an invented identity. Debris remains in the source file for inspection.

The ordinary Build design system action also uses already-applied semantic names and approved canonical names. Generated sheet contents are excluded from subsequent scans. Use Document scope or return to your original artwork page before scanning again.

### Recognize variants from established names
The naming pass now uses existing descriptive character/art/logo names as reference images. Keep an established name such as `blue-ollie` on the original artwork and scan it together with the unknown variants. Generic layer names and generated geometry descriptions are excluded as references.

Matching complete vector geometry produces a reviewable inherited name, with measured suffixes such as `recolored`, `thick-outline`, `thin-outline`, or size. For changed poses, shared normalized vector parts, palette overlap, and relative stroke thickness rank reference candidates for the vision provider. Pose and crop suffixes require visual interpretation. Palette or stroke alone never triggers a mathematical match; incomplete geometry is not treated as exact. Reference images are provided from the first naming batch, and established reference names are preserved and unchecked in the review. Reference-guided proxy requests bypass old naming cache entries so previous generic answers do not suppress the comparison.

Reopen the plugin after rebuilding, and restart the naming server to load its updated reference instructions. Review proposed names before Apply names & build sheets. Matching thresholds are conservative heuristics; live Ollie recognition still needs evaluation against the actual artwork.

Build now starts artwork identification and name review by default before creating sheets. The checkbox “Identify artwork and review names before building” can be turned off to build from existing names only. Small artwork classified as icons can supply reference names and participate in the second visual comparison pass, so small mascot variants are not excluded by their size classification. The selected AI provider must be configured; model failures appear in the naming review.

### Learn from a correction during review
With “Use names I enter to identify similar unnamed items” enabled, type a name into a naming-review row and finish editing the field. The correction becomes a reference immediately. Unambiguous exact geometry matches receive selected name suggestions with measured variation suffixes. Up to eight candidates sharing vector parts are compared with the corrected reference using the selected vision provider; their suggestions remain unchecked for review. Existing named items and unchecked choices are preserved. Apply names saves corrections to source layers, allowing subsequent scans containing those layers to reuse them. This operates on the current exported review batch; it does not search unscanned files or permanently train the model.

### Identify directly from a contact sheet
Rebuild older Assets and Icons sheets once to add stable links to source layers. With DS Foundry open, select one preview, caption, or cell in a generated sheet. The **Identify a contact-sheet item** panel appears at the top of the plugin. Enter the name and choose **Update original & sheets**. No scan or API key is required for this action.

The action updates the original layer's semantic name, its descriptive layer name (except component variant property names), and linked sheet captions. Optionally it also names currently unnamed exact geometry matches represented in linked sheets, with measured variation suffixes. Existing meaningful names are preserved on other matches. Changed poses still use the visual identification review. Multiple selections and missing original artwork are rejected; legacy sheets cannot be linked by guessing from their captions.

### Saved reference library
Restart the updated server and reopen the plugin. Set a project in **Saved reference library**; use the exact same project and server in other Figma files. Save named, checked review rows with **Save selected review items**, or select a linked contact-sheet preview, enter the approved name, and choose **Save as reference**. Saving a reference does not itself rename source artwork.

**Load library** displays approved thumbnails and names. Rename and Delete manage library entries without changing Figma layers. Each entry stores a name, kind, description, PNG thumbnail, and optional vector features. Up to 64 entries are stored per exact project namespace in `DSF_DATA_DIR/approved-references.sqlite3`. Save views with descriptive suffixes; saving the same name/kind updates that example. This is separate from automatically learned naming history and canonical families.

Identification loads approved references across files on the same server. Exact geometry can inherit the stored name; up to six ranked references are supplied per visual batch for other appearances. Reference-guided naming bypasses cached names. An unavailable library is reported while ordinary naming can continue. This is local project memory, not cloud synchronization or model training. Back up the database while the server is stopped.

### Identity and appearance
Expand **Identity & appearance** in a naming-review row, a selected contact-sheet item's panel, or a saved reference. Enter the base identity (for example `Ollie`) separately from color, pose, crop/part, treatment, and orientation. The name is generated in that fixed order: `ollie-pink-waving` or `ollie-blue-eyes-only`.

Applying writes the structured data to source-layer plugin metadata and updates descriptive names. Saving references preserves the same fields; editing a library reference's fields and choosing **Save changes** updates that entry without changing source layers. Build exports structured data in `asset-identities.json`. Existing names are not automatically split or migrated because a color or pose word might be part of an actual identity. Editing the full freeform name clears the structured fields.

Exact matches inherit explicitly established identity and pose/crop fields. Measured palette changes use `recolored` until a color is specified, and measured stroke changes use thick/thin-outline. Changed poses still require visual review; the system does not infer a pose from a geometry score alone. Finish editing the fields and close the details to reuse a correction in the naming review.

### Whole artwork before internal parts
Scanning now treats a grouped icon, logo, character, symbol, or illustration as one asset when its structure supports an artwork boundary. Internal eyes, beaks, outlines, and other nodes are still visited for colors, typography, effects, and layout data, but are not sent separately for naming or promoted to separate sheet assets. An unnamed wrapper containing substantial, spatially separate child drawings is traversed instead of treated as one illustration. This is a conservative grouping heuristic, not automatic reconstruction of ungrouped art.

Detached artwork remains identifiable. Set **Identity** to `ollie` and **crop** to `eyes-only`, `face-only`, or `wing` to mark a part explicitly. Parts appear in **Artwork parts** on the Assets sheet and are omitted from the ordinary Icons sheet. A new `artwork-parts.json` export records parent artwork IDs for internal nodes and explicit identity relationships for detached parts. Rescan the original artwork and rebuild sheets to use the new behavior; source groups are not modified.

### Why a match was suggested
Expand **Why this match?** in the identification review. Up to three references appear beside the candidate, with available evidence: complete normalized geometry, shared vector-part count and overlap, exact palette overlap, and relative stroke-thickness similarity. References merely supplied to visual naming are labeled as such. Measurements are supporting evidence, not confidence probabilities; vector parts are not anatomically identified as eyes or wings.

Choose **Same asset** to adopt the reference identity and appearance, **Variation** to keep its identity and specify a property/value (for example color = pink), or **Different asset** to remove that pair from the current review and unselect its suggestion. Add further variation properties under Identity & appearance. Decisions update the review only; Apply names or Apply names & build sheets writes the changes to Figma. Rejected pairs are now saved per project and loaded across scans and plugin restarts; see Remember rejected matches below.

### Remember rejected matches
**Different asset** saves an undirected exclusion pair in the current project on the local server. Identification loads these decisions before proposing matches, excludes blocked references, bypasses relevant naming cache results, and flags returned names that conflict with excluded identities. If decisions cannot load, naming stops with an error rather than silently ignoring them. This applies to the identification review; canonical-family merge review remains a separate workflow.

Open **Saved reference library → Rejected matches → Load decisions** to inspect decisions. **Forget** removes one; run identification again to reconsider it. A failed save leaves a local exclusion and a Retry saving decisions button; it is not durable until saving succeeds. Decisions use complete normalized geometry plus palette and relative stroke thickness when available, otherwise a thumbnail hash. Names/node IDs do not define the pair. Decisions follow matching appearances across files; substantially changed geometry, color, stroke, or fallback thumbnails can require another decision. They do not ban every future pose of a character indiscriminately.

### Logo evidence and UI exclusions
Width, a rectangular/circular outline, and vector count no longer classify an unknown asset as a logo. Mark-plus-text groups need semantic review: this layout also describes ordinary controls. Explicit logo/wordmark/logotype names and reviewed logo categories remain supported, including text wordmarks and horizontal/stacked lockups. Known logos keep their mark and lettering together during scanning.

Status bars, pagination, and compact sign-in/continue controls are classified as UI before artwork. The same exclusions protect scan results, sheet refresh, and AI name application against stale logo classifications. The Google G alone can be a logo; the enclosing Continue with Google button is a button. Anonymous outlined lettering cannot be identified from dimensions alone; use visual naming, review it, then save a reference.

Reopen the rebuilt plugin, restart the companion server, rescan the original artwork, and rebuild the Assets sheet. Old generated pages do not update automatically. Set the Owting mark-plus-wordmark group to logo through the naming review and save the approved reference in your project.

### Logo composition inspector
Reopen the plugin and restart the updated companion server. Select one original logo group (or a linked contact-sheet item), then choose **Inspect selected logo**. The original thumbnail receives numbered region outlines: signature/text regions in purple, symbol/logotype regions in blue, and unresolved/ignored regions in gray. Choose a role for every region, transcribe outlined lettering when necessary, and enter an approved logo name. **Save composition & approved logo reference** writes reviewed composition metadata to the source and saves a logo reference in the selected library project. It does not rename source layers or change their category. Library failures leave source metadata intact and provide a retry message.

The inspector reads existing grouping and native text, not OCR. Mixed text containers are traversed up to four levels; vector-only subgroups stay together. There is a limit of 48 regions. It cannot split a flattened vector/image into semantic regions or draw custom boxes; restructure a copy into meaningful groups first if necessary. Boxes use axis-aligned visible bounds, so rotated/curved arrangements are approximate. Available arrangement labels are horizontal, stacked, overlapping, symbol-only, and signature-only. Backgrounds can be ignored. This is user-reviewed logo evidence, not automatic brand certification.

References store normalized bounds, text, assigned roles, arrangement, and available region geometry features. Reloaded references supply the reviewed arrangement and lettering/bounds as context for visual naming alongside the full thumbnail. Existing whole-asset geometry matching still operates; independent region-level retrieval and automatic OCR are not implemented. Source selection/image/geometry/text changes invalidate stale save requests. Editing roles requires reinspecting the source; library Rename preserves composition metadata.

# Changelog

## 1.5.0 — 2026-09-12

- Add Canonical Asset Resolution with normalized geometry, independent variant metadata, bounded candidates and optional structured multimodal comparison.
- Add explicit family review and approval, project references, stable IDs, `asset-map.json` and retained layout metadata.
- Preserve naming/build flows and add key-free regression tests. See `CANONICAL_ASSETS.md` in the repository root for limits and native acceptance steps.


## 1.4.0 — 2026-09-12

- **Every vector gets a name.** New classes `symbol`, `illustration`, `logo`, `character`, `tagline`, `copy`, `shape`, `debris`; geometry-derived fallback names (`navy-outline-blob-56x30`, `navy-14-piece-250x270`) replace Figma auto names so nothing stays "Vector 123".
- **Debris detection** (specks, empty paths, invisible fragments) with **Select on page** in the Elements tab.
- **AI naming returns `kind`** and may reclassify; `abstract` answers are queued for the designer instead of guessed; a **reference pass** re-examines low-confidence characters, illustrations and symbols against confidently named characters and logos (other views: `owl-mascot-back`). Proxy mode sends and receives references.
- New AI targets: logos/characters/illustrations, taglines/copy.
- **`DS · Assets` contact sheet**: index plus Logos, Characters, Illustrations, Symbols, Icons, Buttons & badges, Taglines, Copy, Vectors & shapes, Debris; distinct items only, vector classes promoted to components.

## 1.3.2 — 2026-09-12

- Manifest fix: `devAllowedDomains` now lists only `http://localhost:8000`. Figma's manifest validator accepts domain and localhost patterns but not IP literals, and `http://127.0.0.1:8000` made Figma flag the plugin with "Manifest issue".

## 1.3.1 — 2026-09-12

- Packaging only: removed a stray empty `{src,ui,dist,tools}` folder that shipped in earlier zips. No code changes.

## 1.3.0 — 2026-09-11

- **Proxy provider** for AI naming: talk to the companion `ds-foundry-server` (FastAPI + LangGraph) with project namespaces, critic and learn toggles, upstream provider/model selection, and source/confidence shown per row.
- Manifest `devAllowedDomains` for `localhost:8000` / `127.0.0.1:8000`.

## 1.2.0 — 2026-09-11

- **Gemini support** for AI naming: choose Claude or Gemini per run, with separate stored keys. Gemini calls use `generateContent` with system instructions, inline PNG parts and JSON response mode.
- **Custom model ID** option for both providers.
- Manifest allows `generativelanguage.googleapis.com` in addition to `api.anthropic.com`.

## 1.1.0 — 2026-09-11

- **AI naming**: name icons, images, screens, sections, nav bars, cards, list items, local components and plain shapes by what they visually show, using the Claude API with your own key (stored in Figma client storage). Distinct items are thumbnailed, batched 10 per request, reviewed in an editable list, then applied with the same reversible label mechanism.
- Inventory now records plain shapes (for AI naming only).
- Manifest allows network access to `api.anthropic.com` only.

## 1.0.0 — 2026-09-11

First release.

- Scan selection, page or document; non-blocking with Stop.
- Inventory: colours, text styles, spacing, radii, effects, elements by category, icons, components in use, missing fonts.
- Semantic naming: colour roles (primary/secondary/neutral/error/success/warning/info) with 500-anchored steps; type roles by size and weight; spacing snapped to a 4 or 8 grid; radius t-shirt sizes; elevation ranking.
- Build: layer labels (reversible), colour/text/effect styles, `DS Foundry / Primitives` variables bound to colour styles, `DS · Foundations`, `DS · Components` (variant sets sampled from the file + existing-component gallery), `DS · Icons`, optional screen arrangement.
- Export: DTCG `tokens.json`, `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, `inventory.json`, single-zip download.

### Contact-sheet identification fixes
- Added Apply names & build sheets after visual naming review.
- Preserve reviewed names and corrected categories during builds; reuse approved canonical names.
- Include input, checkbox, toggle, card, navigation, and native component artwork in the Assets sheet; show possible vector debris visually without promoting it to reusable components.
- Keep same-size unrelated vectors separate, exclude generated sheets from scans, and surface empty source scans before replacing sheets.
- Flush partial thumbnail batches when later exports fail, and process thumbnail messages in order.

### Reference-based variation naming
- Seed visual naming with existing descriptive names and reference images from the first batch.
- Compare normalized geometry and shared vector parts; use palette and normalized stroke thickness as supporting evidence.
- Suggest inherited names for unambiguous exact geometry with measured variation suffixes; use vision and review for changed poses, crops and scenes.
- Preserve reference names and bypass stale naming cache results during reference-guided proxy comparisons.

### Learn from manual identification
- Manual review names immediately become references for unnamed items in the current batch.
- Exact, unambiguous geometry matches inherit selected name suggestions and measured variation suffixes.
- Up to eight similar candidates receive reference-guided visual comparisons; their suggestions remain unchecked.
- Preserve existing names and selection choices across review updates.

### Identify directly from contact sheets
- Assets and Icons cells store stable source IDs and caption markers.
- Selecting a cell, preview or caption exposes a name field without rescanning.
- Update original source names and all linked captions; optionally propagate to unnamed exact geometry matches.
- Preserve named matches and component variant syntax; check source/selection validity and load fonts before writes, with rollback on write errors.

### Saved project reference library
- Browse approved thumbnails, rename references, and delete entries.
- Explicitly save selected naming-review items or a linked contact-sheet original.
- Load saved geometry and images into identification across files sharing a server/project.
- Show partial-save and unavailable-library errors.

### Separate identity and appearance
- Add explicit identity, color, pose, crop/part, treatment, and orientation fields to review, sheet identification, and saved references.
- Generate names in a stable order while preserving legacy freeform names until explicitly edited.
- Persist structured names on source layers and in reference storage, inherit them on exact matches, and export asset-identities.json.

### Whole artwork and parts
- Recognize grouped artwork before its descendants; keep inner nodes for token/layout extraction without creating duplicate asset candidates.
- Traverse unnamed wrappers of substantial separated drawings to avoid collapsing galleries.
- Add an Artwork parts sheet section for explicitly identified crops/parts, and export artwork-parts.json relationships.

### Match evidence and decisions
- Add side-by-side candidate/reference review with exact geometry, shared parts, palette, and stroke evidence.
- Distinguish measured matches from references merely supplied to visual naming.
- Same asset, Variation, and Different asset update the naming review without writing source layers until Apply.
- Exclude rejected pairs within the current review and clear prior accepted suggestions when that pair is rejected.

### Persistent rejected matches
- Save Different asset decisions per project with stable, appearance-specific keys; reload before identification.
- Exclude rejected references and conflicting proposed names, including proxy cache/automatic-reference paths.
- Add saved-decision listing, Forget, and explicit retry for failed saves.

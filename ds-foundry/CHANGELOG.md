# Changelog

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

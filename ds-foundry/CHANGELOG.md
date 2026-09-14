# 1.6.9 — whole characters from nested artwork

- Add Find whole characters in artwork to Steps 1 and 5. Search nested vector groups and recheck named illustrations, including Ollie, without losing their names.
- Review complete characters separately from scenes, body/wing/face fragments, uncertain groups and redundant nested copies. Keep pink, grey, yellow and green as visible appearance descriptions; identity still requires reference evidence.
- Promote approved nested groups into Characters as editable copies, keeping source scenes intact and retaining approved groups on later scans. Report the bounded review budget and deferred groups.
- Send legacy blue-ollie-body/wing fragments to Artwork parts and exclude them from whole-character reference evidence.
- Preserve inherited rotation/reflection and fit complete rendered bounds inside Assets tiles. Resize tile frames without applying child constraints, avoiding shifted/distorted eye groups.
- Validate live copies of four real character groups and save their actual layer hierarchy as regression data. Model classification tests are offline fixtures, not measured Gemini accuracy.
- Companion server 0.3.2 updates classification prompts and rejects fragment names as whole-character references. Gemini defaults, current-logo approval, saved-name recovery and actual request diagnostics remain in place.

# 1.6.8 — Gemini by default

- Start with Local server (.env keys) and Gemini · server default for artwork naming and asset-family comparisons.
- Use Gemini when an upstream provider is omitted. Claude remains available through an explicit selection.

# 1.6.7 — actual request errors

- Show HTTP status and original diagnostics for direct providers and local-server naming, library and asset-family requests. Preserve FastAPI detail messages, validation errors and provider error bodies; redact credentials.
- Keep a persistent Request errors & retries panel in Step 5. Mixed outcomes say Partly identified and retain failed-item details alongside successful names.
- Retry eligible transient naming failures at most once with Retry-After/backoff. Do not automatically replay permanent failures, waits over 60 seconds, unknown network completion or server-reported partial pipelines.
- Exclude request failures from the second visual comparison pass. Asset-family comparison failures retain the actual diagnostic and keep candidates separate for review.
- Companion server 0.3.1 preserves provider status, model and phase instead of converting all naming failures to HTTP 502. Requires both updated plugin and server for full diagnostics.
- Regression coverage uses simulated SDK/provider errors and local fixtures; no paid model requests are needed.

# 1.6.6 — retain recognition references

- Retain saved pose examples even when a local example has the same name. Rank references per batch and include the saved library in the second visual comparison pass.
- Keep established names without geometry features intact during mixed naming runs. Use named artwork from the scan as references independently of target-category checkboxes.
- Add Recognize artwork automatically to Step 1, with a direct document scan and Step 5 review. Show loaded reference counts and names; clarify that logo region approval is separate from character recognition.
- Keep exact-match reuse, rejected-match exclusions, name review and current-logo approval rules. New poses still require visual comparison; color alone does not establish identity.
- Add regression fixtures for same-name saved poses, reference ranking, library-assisted second look, preserved names and the automatic recognition shortcut. Real-file recognition quality still needs validation in Figma.

# 1.6.5 — detailed tool workflow

- Use the requested 1.6.5 version for this detailed UI edition, superseding the local 1.7.0 workflow iteration below.
- Number the individual tools: contact-sheet identification, logo inspector, saved library, scan, artwork naming, family comparison, build, and export.
- Add per-step states and a persistent activity panel with elapsed time, actual phase messages, reported percentages and a delayed-response notice.
- Show exactly which logo regions need a role; prevent incomplete saves and track source approval separately from reference persistence.
- Keep failures, partial saves and stopped operations visible with retryable controls. Clear processing indicators when work ends; ignore late progress after completion.
- Add bounded library/model request timeouts and regression checks for state transitions and the requested step order.

# 1.7.0

- Introduce five guided steps: Scan, References, Identify, Build, and Inspect, with prominent headings and a persistent progress navigator.
- Applying reviewed names now opens Build options; creating pages requires the Build design system action.
- Keep review choices while moving between steps, and preserve them when the inventory prefix refreshes.
- Unlock steps as prerequisites finish; busy operations disable navigation, and failures stay in the current step for retry.
- Keep no-AI Assets refresh, full-document identification, and linked sheet corrections as returning-user shortcuts.

# 1.6.4

- Add a full-document identification/rebuild flow for Foundations, Components, Icons and sectioned Assets.
- Share established-name recovery between sheet captions and AI references, including saved original names and structured identities.
- Preserve conflicting names on identical geometry; do not merge their rename targets.
- Prioritize unnamed illustrations before icons; named reference thumbnails do not consume the unnamed-item budget.
- Allow reviewed builds with saved names only; report deferred naming items and failed exports.

# 1.6.3

- Add Rebuild Assets now (no AI): fresh document scan, current source approvals, Assets-only output, no naming-provider calls or source renames.

# 1.6.2

- Stamp Assets section names and subtitles with generation date/time (UTC) and plugin version, including Logos.
- Store build time/version on generated sections for diagnostics; existing sheets are not restamped without rebuilding.

# 1.6.1

- Composition save now approves the original logo and semantic name.
- Logos output requires current source approval; stale guesses remain outside Logos.
- Artwork changes invalidate approval. UI exclusions continue to take precedence.

# 1.6.0

- Show the package version in the Figma development-plugin name and upper-left plugin heading; build keeps both synchronized.
- Includes logo composition inspection and the final logo-output audit, marked logo-audit-3.

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

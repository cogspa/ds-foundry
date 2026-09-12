# IDE prompt — DS Foundry

Paste this into Claude Code / Cursor when working in this repo.

---

You are working on **DS Foundry**, a Figma plugin (TypeScript, esbuild, `@figma/plugin-typings`) that scans a Figma file and generates a design system from it. Read `README.md` first.

Architecture:
- `src/code.ts` — main-thread entry; routes `scan`, `relabel`, `build`, `revert`, `cancel` messages from the UI.
- `src/scan.ts` — iterative walk of the selected scope; collects `Inventory` (colours, type, spacing, radii, effects, elements, icons, components in use). Must stay non-blocking: call `await tick()` every few hundred nodes and check `cancelled`.
- `src/classify.ts` — pure heuristics returning a `Category` per node plus a `desc` (geometry description used as the fallback name: `describeShape` for primitives/paths, `describeGroup` for vector groups). Tiers: icon ≤ 64 px → symbol ≤ 200 px / few pieces → illustration; logo by lockup shape or name; debris for specks/empty/invisible; tagline/copy for text. `character` is only ever assigned by AI naming (`kind`). Keep it deterministic and free of side effects; `isDefaultName` in `naming.ts` decides when a Figma auto name is replaced by `desc`.
- `src/naming.ts` — token names (`primary/500`, `heading/lg/semibold`, `space/8`, `radius/md`, `elevation/2`) and layer labels (`ds/button/primary-md/sign-up`).
- `src/build.ts` — creates styles, variables, the four `DS · …` pages (Foundations, Components, Icons, Assets — `buildAssets` reads `dsf.category` plugin data first so AI reclassifications regroup the contact sheet), component sets, icon components; everything it creates carries plugin data `dsf.generated = "1"` so a rebuild can replace it. Never mutate the user's original nodes except renaming (which stores `dsf.originalName`).
- `src/ai.ts` — AI naming. Main thread picks distinct candidates (icons, images, screens/sections/nav, cards/list items, local components, shapes), exports PNG thumbnails with `exportAsync`, streams them to the UI as `ai_items` chunks, and applies chosen names on `ai_apply`. The UI (`ui/ui.html`) composites thumbnails on white, calls the chosen provider directly — Claude at `https://api.anthropic.com/v1/messages` (BYOK, header `anthropic-dangerous-direct-browser-access: true`, IDs `claude-sonnet-5` / `claude-haiku-4-5` / `claude-opus-5`) or Gemini at `https://generativelanguage.googleapis.com/v1beta/models/{id}:generateContent` (`x-goog-api-key`, `systemInstruction`, `inlineData` parts, `responseMimeType: application/json`; IDs `gemini-3.7-flash` / `gemini-3.8-flash` / `gemini-3.5-flash-lite` / `gemini-3.1-pro-preview`, plus a custom-ID field) — 10 images per request, 3 concurrent, then renders an editable review list. Providers are a `PROVIDERS` table plus `callClaude` / `callGemini` / `callProxy` (the last posts `NameRequest` batches to the companion `ds-foundry-server` and reads `NameResponse`); add a provider by adding an entry and a caller that returns the model's text. Keys live per provider in `figma.clientStorage`.
- `src/tokens.ts` — DTCG `tokens.json`, `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, `inventory.json`.
- `ui/ui.html` — single-file panel; copied verbatim to `dist/ui.html`. Uses Figma theme CSS variables. Downloads are built client-side (includes a store-only zip writer).

Constraints:
- `manifest.json` uses `documentAccess: "dynamic-page"`: use the `*Async` APIs (`getNodeByIdAsync`, `getLocalPaintStylesAsync`, `setTextStyleIdAsync`, `loadAllPagesAsync`, `setCurrentPageAsync`). Load a page with `page.loadAsync()` before touching its children.
- Load fonts with `figma.loadFontAsync` before setting `characters`, `fontName` or text-style properties; fall back to Inter Regular.
- `networkAccess.allowedDomains` is `["https://api.anthropic.com", "https://generativelanguage.googleapis.com"]` only — no other external requests or scripts in the UI.
- Run `npm run check` (tsc + esbuild) before finishing. `dist/` is committed so the plugin imports without a build step.
- Semver: bump `package.json`, `README.md` heading, the version in `src/tokens.ts` and the header in `ui/ui.html` together; add a `CHANGELOG.md` entry; release as `ds-foundry-vX.Y.Z.zip` excluding `node_modules`.

Roadmap candidates (pick one at a time):
1. Semantic variable collection (`bg/surface`, `text/primary`, `border/subtle`) aliased to primitives, with light/dark modes inferred from screen fills.
2. "Replace originals with instances" — swap sampled buttons/badges in the source screens for instances of the generated variants, matching by fingerprint.
3. Gradient and image-fill tokens; per-corner radius tokens.
4. Export to Style Dictionary / Tokens Studio JSON and a Storybook MDX doc.
5. Smarter icon dedupe using `vectorNetwork` hashing instead of name + size + child count.
6. Per-category confidence scores in the inventory tab, with a manual override before Build.
7. AI naming v2: let the model also re-classify (button vs badge vs input) and describe component variants as `Prop=Value` names; use the Message Batches API for very large files.

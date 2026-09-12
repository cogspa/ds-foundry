# DS Foundry

An automated **design system generator, asset organizer, and AI-assisted layer namer** for Figma.

DS Foundry scans any Figma file (or page, or selection), heuristically inventories its visual language and UI components, names unnamed layers and vectors using multimodal AI, and constructs a complete, production-ready design system with styles, variables, component sets, and token exports.

---

## Repository Structure

```
.
├── ds-foundry/               # Figma Plugin (TypeScript + esbuild + UI panel)
│   ├── src/                  # Plugin backend logic (scanner, classifier, builder, tokens)
│   ├── ui/                   # Single-file HTML/CSS/JS plugin panel
│   ├── dist/                 # Pre-built plugin bundles (code.js, ui.html)
│   ├── manifest.json         # Figma manifest configuration
│   └── package.json
│
├── ds-foundry-server/        # Companion AI Naming Proxy (FastAPI + LangGraph)
│   ├── app/                  # LangGraph pipeline, prompts, glossary, FastAPI routes
│   ├── tests/                # Automated pytest test suite
│   ├── requirements.txt      # Python dependencies
│   ├── run.sh                # Server launch script
│   └── .env.example          # Environment template for Anthropic / Google keys
│
└── install-ds-foundry.sh     # macOS installer & lifecycle management script
```

---

## Key Features

### 1. Automated Design System Construction
* **Foundations**: Automatically derives color roles (`primary`, `secondary`, `neutral`, `error`, etc.), typography scales, spacing grids (4px or 8px), and corner radius tokens.
* **Figma Variables & Styles**: Generates local Color, Text, and Effect styles, plus a `DS Foundry / Primitives` Variables collection.
* **Component Sets**: Recognizes buttons, inputs, badges, cards, and avatars; clones distinct instances and organizes them into component sets with variant properties (`Style`, `Size`).
* **Icons & Assets Sheet**: Centers vector icons on standard frames, promotes brand marks and illustrations into an indexed contact sheet, and identifies "debris" (invisible or micro-specks under 6px) for one-click cleanup.
* **Token Export**: Generates W3C DTCG `tokens.json`, `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, and `inventory.json`.

### 2. Multimodal AI Visual Naming (`ds-foundry-server`)
Heuristics categorize layers by geometry, but AI visual naming inspects thumbnails and labels what they actually show (e.g. `ds/icon/arrow-left` instead of `vector-14`, or `ds/card/pricing-plan` instead of `frame-3`).
* **LangGraph Pipeline**: `Cache lookup → Propose → Critic pass → Align with glossary → Reconcile references → Finalize`.
* **Critic Pass**: Rejects generic labels, enforces kebab-case conventions, and retries ambiguous candidates.
* **Glossary & Consistency**: Preserves accepted names across files to avoid naming drift (e.g. keeps "search" consistent rather than drifting to "magnifier").
* **Reference Learning**: Identifies mascots, logos, and characters to maintain consistent naming across multiple perspectives and poses.
* **Provider Flexibility**: Supports Claude (Anthropic), Gemini (Google AI), or local Ollama vision models.

### 3. Safe & Non-Destructive
* **Build confirmation**: Nothing in the Figma document changes until you click **Build design system**.
* **Reversible**: Original layer names are preserved in plugin data; clicking **Revert labels** restores them at any point.

---

## Quick Start

### 1. Start the Naming Server

You can start the server directly using the helper script:

```bash
./install-ds-foundry.sh start
```

Or run manually:

```bash
cd ds-foundry-server
cp .env.example .env     # Add ANTHROPIC_API_KEY and/or GOOGLE_API_KEY
./run.sh
```

The server runs on `http://localhost:8000`. Test health with:
```bash
curl http://localhost:8000/health
```

### 2. Import Plugin into Figma

1. Open the Figma desktop app.
2. Navigate to: **Plugins → Development → Import plugin from manifest…**
3. Select `ds-foundry/manifest.json`.
4. Open any design file and launch **Plugins → Development → DS Foundry**.

### 3. Run a Scan & Generate

1. Choose a scan scope (**Selection**, **Page**, or **Document**) and click **Scan**.
2. (Optional) In **AI naming**, choose **Provider: Proxy** (`http://localhost:8000`), select your preferred model, and click **Suggest names**. Review and apply.
3. Configure your prefix (default `ds/`) and spacing grid.
4. Click **Build design system** and download your exported tokens (`tokens.json`, `tokens.css`, `tailwind.tokens.cjs`).

---

## Development

### Figma Plugin
```bash
cd ds-foundry
npm install
npm run check    # Typecheck with tsc & bundle via esbuild
npm run watch    # Watch mode for active development
```

### Naming Server
```bash
cd ds-foundry-server
pytest -q tests  # Run tests against injected mock chat models
```

---

## License

MIT License. See individual package documentation for further details.

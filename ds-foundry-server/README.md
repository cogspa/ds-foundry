# DS Foundry naming server 0.2.0

A small FastAPI + LangGraph service that the DS Foundry Figma plugin (v1.3.0+) can use instead of calling Claude or Gemini directly. It turns "name this thumbnail" into a pipeline:

```
lookup_cache → propose (vision, with references) → critique (cheap text model) ─┬─ reject? → retry once with feedback
                                                                                 └─ align to glossary → dedupe → reconcile (second look vs references) → finalize (cache + learn + store references)
```

What that buys you over the in-plugin calls:

- **Critic pass** — a second, cheaper model rejects generic names, catches contradictions with visible text, enforces kebab-case, and prefers glossary terms. Rejected items are re-proposed once with the reason attached.
- **Glossary** — accepted names are remembered per project, so "search" stays "search" across files instead of drifting to "magnifier". Matching is token overlap; swap `Glossary.similar()` for embeddings if you outgrow it.
- **Kinds and abstraction** — every result carries a `kind` (icon, symbol, logo, character, illustration, tagline, copy, shape, debris…) the model may correct; items the model can't name honestly come back as `kind: abstract` with an empty name for the designer, never a guess.
- **References** — characters and logos named with ≥ 80% confidence are stored per project with their thumbnail (`data/refs/`). They're shown to the model on every later batch and file, and a `reconcile` pass re-examines low-confidence characters/illustrations/symbols against them, so the back of a mascot becomes `owl-mascot-back`. `GET /references/{project}` lists them; `DELETE /references/{project}/{name}` forgets one.
- **Cache** — fingerprint → name. Re-running on a file you've already named makes zero model calls.
- **Provider routing** — Claude, Gemini or a local Ollama vision model behind one endpoint. Keys live on the server or come with each request.
- **Structured, typed** — Pydantic v2 models for every message; LangSmith tracing with two env vars.

## Run

```bash
cp .env.example .env     # add ANTHROPIC_API_KEY and/or GOOGLE_API_KEY
./run.sh                 # venv + install + uvicorn on http://127.0.0.1:8000
```

Then in the plugin: **AI naming → Provider: Proxy**, server `http://localhost:8000`, pick an upstream (Claude / Gemini / Ollama, server default or a specific model), set a **Project** name (this is the glossary and cache namespace), and Suggest names as usual. Each row shows where its name came from — `model`, `critic`, `glossary` or `cache` — and the confidence.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Version, which providers have keys, default models |
| `POST` | `/name` | `{provider, model?, api_key?, project, critic, learn, use_cache, items[]}` → `{results[], usage}` |
| `GET` | `/glossary/{project}` | Current terms |
| `POST` | `/glossary/{project}` | Upsert a term `{category, name, what, aliases[]}` — seed house conventions before the first run |
| `DELETE` | `/glossary/{project}/{category}/{name}` | Remove a term |
| `DELETE` | `/cache/{project}` | Forget cached names |

Items: `{key, category, name, desc, text, w, h, image}` where `image` is base64 PNG. Up to 40 per request. Optional `references: [{name, what, kind, image}]` from the plugin are merged with the stored ones.

## Layout

- `app/schemas.py` — request/response models
- `app/providers.py` — `get_chat_model(provider, model, key)` for Claude / Gemini / Ollama, plus per-provider critic defaults
- `app/prompts.py` — namer and critic system prompts
- `app/glossary.py` — JSON-backed glossary and cache under `DSF_DATA_DIR`
- `app/graph.py` — the LangGraph state machine; `build_graph()` takes injected models so tests run against fakes
- `app/main.py` — FastAPI routes, CORS open (the Figma plugin iframe has a `null` origin)
- `tests/test_graph.py` — full graph + HTTP layer with `FakeListChatModel`, no network: `pytest -q`

## Notes

- The critic sees text only (proposals, descriptions, context), not images — it's cheap. If you want it to look, pass the images in `critique()` the same way `propose()` does.
- Gemini and Ollama image input uses the standard `image_url` data-URL content block, which `langchain-google-genai` and `langchain-ollama` both accept.
- Ollama needs a vision model (`ollama pull llama3.2-vision`) and `pip install langchain-ollama`.

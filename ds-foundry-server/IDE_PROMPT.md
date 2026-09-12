# IDE prompt — DS Foundry naming server

You are working on the **DS Foundry naming server**: FastAPI + LangGraph + Pydantic v2, Python 3.11+. It backs the "Proxy" provider in the DS Foundry Figma plugin. Read `README.md` first.

Pipeline (`app/graph.py`): `lookup_cache → propose → critique → (retry once) → align → reconcile → finalize`. `reconcile` gives low-confidence character/illustration/symbol items a second look with references (stored `Refs` + plugin-supplied + confidently named in this batch); `finalize` stores new character/logo references with thumbnails. `build_graph(namer, critic, glossary, cache)` takes injected LangChain chat models so `tests/test_graph.py` runs with `FakeListChatModel` and no keys. Keep that property: never construct models inside nodes.

Conventions:
- All I/O shapes are Pydantic models in `app/schemas.py`; the plugin depends on `NameRequest` / `NameResponse` exactly — bump the plugin if you change them.
- Model replies are parsed as a JSON array (`_extract_json_array`) rather than `with_structured_output`, because that works identically across Claude, Gemini and Ollama with image inputs. Keep the fallback behaviour: a broken reply never fails the request, it degrades to a low-confidence deterministic name with an `unresolved:` note.
- Generic names (`GENERIC` set) are always rejected regardless of what the critic says.
- Glossary and cache are per-project JSON files under `DSF_DATA_DIR`. `Glossary.similar()` is the only place matching lives — replace it with embeddings (e.g. `langchain-huggingface` + a local MiniLM) without touching the graph.
- Run `pytest -q` before finishing.

Roadmap candidates:
1. Embedding-based glossary matching with a per-project FAISS index.
2. A `/classify` node that lets the model correct the plugin's heuristic category (button vs badge vs input) and returns it alongside the name.
3. Batch API mode for very large files (submit, poll, plugin fetches results later).
4. A tiny web UI at `/` to browse and edit the glossary.
5. LangSmith eval dataset: a folder of thumbnails with gold names; `make eval` reports agreement per category.

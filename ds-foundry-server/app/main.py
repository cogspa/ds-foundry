from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .glossary import Cache, Glossary, Refs
from .graph import run_naming
from .providers import DEFAULT_MODELS, configured_providers, get_chat_model, get_critic_model
from .schemas import GlossaryEntry, NameRequest, NameResponse

VERSION = "0.2.0"

app = FastAPI(title="DS Foundry naming service", version=VERSION)

# The Figma plugin panel runs in a sandboxed iframe whose origin is "null", so the wildcard is required.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "version": VERSION, "providers": configured_providers(), "defaults": DEFAULT_MODELS}


@app.post("/name", response_model=NameResponse)
def name(req: NameRequest):
    key = req.api_key or None
    if req.provider == "anthropic" and not (key or os.environ.get("ANTHROPIC_API_KEY")):
        raise HTTPException(400, "No Anthropic key: set ANTHROPIC_API_KEY on the server or send api_key")
    if req.provider == "gemini" and not (key or os.environ.get("GOOGLE_API_KEY")):
        raise HTTPException(400, "No Gemini key: set GOOGLE_API_KEY on the server or send api_key")
    try:
        namer = get_chat_model(req.provider, req.model, key)
        critic = get_critic_model(req.provider, req.model, key) if req.critic else None
    except Exception as e:
        raise HTTPException(400, f"Could not create model: {e}")
    glossary = Glossary(req.project)
    cache = Cache(req.project)
    refs = Refs(req.project)
    try:
        results, usage = run_naming(req.items, namer, critic, glossary, cache, req.critic, req.learn, req.use_cache, refs, req.references)
    except Exception as e:
        raise HTTPException(502, f"Naming failed: {e}")
    return NameResponse(results=results, usage=usage)


@app.get("/glossary/{project}")
def get_glossary(project: str):
    return [e.model_dump() for e in Glossary(project).entries.values()]


@app.post("/glossary/{project}")
def upsert_glossary(project: str, entry: GlossaryEntry):
    g = Glossary(project)
    g.upsert(entry)
    g.save()
    return {"ok": True, "count": len(g.entries)}


@app.delete("/glossary/{project}/{category}/{name}")
def delete_glossary(project: str, category: str, name: str):
    g = Glossary(project)
    ok = g.remove(category, name)
    g.save()
    return {"ok": ok}


@app.get("/references/{project}")
def get_references(project: str):
    return [{k: v for k, v in r.items() if k != "image"} for r in Refs(project).all()]


@app.delete("/references/{project}/{name}")
def delete_reference(project: str, name: str):
    r = Refs(project)
    before = len(r.rows)
    r.rows = [x for x in r.rows if x["name"] != name]
    r.save()
    return {"ok": len(r.rows) < before}


@app.delete("/cache/{project}")
def clear_cache(project: str):
    c = Cache(project)
    n = len(c.rows)
    c.rows = {}
    c.save()
    return {"ok": True, "cleared": n}

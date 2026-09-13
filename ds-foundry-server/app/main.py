from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .glossary import Cache, Glossary, Refs
from .graph import run_naming
from .providers import DEFAULT_MODELS, configured_providers, get_chat_model, get_critic_model
from .schemas import GlossaryEntry, NameRequest, NameResponse

from .asset_schemas import ResolveRequest, ApprovalRequest, AssetMap
from .asset_store import AssetStore
from .assets import resolve

VERSION = "0.3.0"

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
    excluded=set(req.excluded_reference_names)
    if excluded:
        original_all=refs.all
        refs.all=lambda: [r for r in original_all() if r['name'] not in excluded]
        req.references=[r for r in req.references if r.name not in excluded]
        req.use_cache=False
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


@app.post('/assets/resolve', response_model=AssetMap)
def resolve_assets(req: ResolveRequest):
    store = AssetStore(req.project)
    class LazyModel:
        instance = None
        def invoke(self, messages):
            if self.instance is None:
                self.instance = get_chat_model(req.provider, req.model, req.api_key, temperature=0, max_tokens=1800)
            return self.instance.invoke(messages)
    model = LazyModel() if req.useModel and req.maxModelCalls else None
    return resolve(req, store.all(), store.rejected(), model)

@app.post('/assets/approve/{project}')
def approve_assets(project: str, req: ApprovalRequest):
    try:
        AssetStore(project).approve(req)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {'ok': True, 'saved': len(req.families)}

@app.get('/assets/references/{project}')
def asset_references(project: str):
    return [{k:v for k,v in f.items() if k != 'samples'} | {'referenceCount':len(f['samples'])} for f in AssetStore(project).all()]

# Human-approved project reference library. Reading/writing never calls a model.
from .reference_library import ReferenceLibrary, LibraryEntry, Rename

@app.get('/library/{project}')
def library_list(project: str):
    return ReferenceLibrary(project).all()

@app.post('/library/{project}')
def library_save(project: str, entry: LibraryEntry):
    try: return ReferenceLibrary(project).save(entry)
    except ValueError as e: raise HTTPException(409,str(e))

@app.patch('/library/{project}/{id}')
def library_rename(project: str,id: str,entry: Rename):
    try: found=ReferenceLibrary(project).rename(id,entry.name,entry.assetName)
    except ValueError as e: raise HTTPException(409,str(e))
    if not found: raise HTTPException(404,'Reference not found')
    return {'ok':True}

@app.delete('/library/{project}/{id}')
def library_delete(project: str,id: str):
    if not ReferenceLibrary(project).delete(id): raise HTTPException(404,'Reference not found')
    return {'ok':True}


from .reference_library import RejectedMatch, RejectionStore

@app.get('/library/{project}/rejections')
def rejected_list(project:str):return RejectionStore(project).all()

@app.post('/library/{project}/rejections')
def rejected_save(project:str,entry:RejectedMatch):
    try:return RejectionStore(project).save(entry)
    except ValueError as e:raise HTTPException(409,str(e))

@app.delete('/library/{project}/rejections/{id}')
def rejected_delete(project:str,id:str):
    if not RejectionStore(project).delete(id):raise HTTPException(404,'Decision not found')
    return {'ok':True}

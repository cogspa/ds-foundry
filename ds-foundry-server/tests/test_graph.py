"""Runs the whole graph and the HTTP layer against fake chat models — no API keys, no network."""
import json, os, tempfile
os.environ["DSF_DATA_DIR"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.glossary import Cache, Glossary
from app.graph import run_naming
from app.schemas import Item
from app import main as main_mod

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

def items():
    return [
        Item(key="fp-search", category="icon", name="Vector 12", image=PNG, w=24, h=24),
        Item(key="fp-arrow", category="icon", name="Vector 13", image=PNG, w=24, h=24),
        Item(key="fp-btn", category="component", name="Button/Primary", text="Sign up", image=PNG, w=120, h=40),
    ]

def test_critic_rename_retry_and_glossary_alignment():
    namer = FakeListChatModel(responses=[
        # round 1: one good, one generic, one contradicting the visible text
        json.dumps([{"i": 0, "name": "search", "what": "magnifying glass", "confidence": 0.95},
                    {"i": 1, "name": "icon", "what": "arrow pointing left", "confidence": 0.4},
                    {"i": 2, "name": "login-button", "what": "blue primary button", "confidence": 0.8}]),
        # round 2: only the rejected item comes back (as #0 of the new batch)
        json.dumps([{"i": 0, "name": "arrow-left", "what": "arrow pointing left", "confidence": 0.9}]),
    ])
    critic = FakeListChatModel(responses=[
        json.dumps([{"i": 0, "action": "keep"},
                    {"i": 1, "action": "reject", "reason": "generic"},
                    {"i": 2, "action": "rename", "name": "sign-up-button", "reason": "text says Sign up"}]),
        json.dumps([{"i": 0, "action": "keep"}]),
    ])
    g, c = Glossary("test-a"), Cache("test-a")
    results, usage = run_naming(items(), namer, critic, g, c, use_critic=True, learn=True, use_cache=True)
    by = {r.key: r for r in results}
    assert by["fp-search"].name == "search" and by["fp-search"].source == "model"
    assert by["fp-arrow"].name == "arrow-left" and usage.rounds == 2
    assert by["fp-btn"].name == "sign-up-button" and by["fp-btn"].source == "critic"
    assert usage.calls == 4 and usage.critic_changes == 1

    # second run: everything is cached, no model calls at all
    results2, usage2 = run_naming(items(), FakeListChatModel(responses=["[]"]), None, Glossary("test-a"), Cache("test-a"), True, True, True)
    assert usage2.cached == 3 and usage2.calls == 0 and all(r.source == "cache" for r in results2)

    # a new file proposing "magnifier" for the same kind of icon is pulled back to the glossary term
    namer3 = FakeListChatModel(responses=[json.dumps([{"i": 0, "name": "magnifier", "what": "magnifying glass search", "confidence": 0.9}])])
    r3, u3 = run_naming([Item(key="fp-new", category="icon", name="Vector 99", image=PNG)], namer3, None, Glossary("test-a"), Cache("test-a"), False, True, True)
    assert r3[0].name == "search" and r3[0].source == "glossary" and u3.glossary_hits == 1

def test_http_layer_with_injected_models(monkeypatch):
    fake = FakeListChatModel(responses=[json.dumps([{"i": 0, "name": "checkout-summary", "what": "order review screen", "confidence": 0.9}])])
    monkeypatch.setattr(main_mod, "get_chat_model", lambda *a, **k: fake)
    monkeypatch.setattr(main_mod, "get_critic_model", lambda *a, **k: None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    client = TestClient(main_mod.app)
    assert client.get("/health").json()["ok"] is True
    r = client.post("/name", json={"provider": "anthropic", "project": "http", "critic": False,
                                   "items": [{"key": "k1", "category": "screen", "name": "Frame 3", "image": "data:image/png;base64," + PNG}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["results"][0]["name"] == "checkout-summary" and body["usage"]["calls"] == 1
    assert client.get("/glossary/http").json()[0]["name"] == "checkout-summary"
    assert client.delete("/cache/http").json()["cleared"] == 1


def test_abstract_and_reference_reconcile():
    """Front of the owl is named confidently; the back view starts low-confidence and is matched via the reference pass.
    An abstract blob is left for the designer instead of guessed."""
    from app.glossary import Refs
    owl_front = Item(key="fp-owl-front", category="illustration", name="Group 7", image=PNG, w=200, h=240)
    owl_back = Item(key="fp-owl-back", category="symbol", name="Vector 44", image=PNG, w=180, h=230)
    blob = Item(key="fp-blob", category="shape", name="Vector 9", desc="pale-blue-blob-56x30", image=PNG, w=56, h=30)
    namer = FakeListChatModel(responses=[
        json.dumps([{"i": 0, "name": "owl-mascot", "what": "green owl mascot facing front", "kind": "character", "confidence": 0.95},
                    {"i": 1, "name": "green-bird-shape", "what": "rounded green figure from behind", "kind": "illustration", "confidence": 0.45},
                    {"i": 2, "name": "", "what": "soft blue blob", "kind": "abstract", "confidence": 0.2}]),
        # reconcile pass for the low-confidence item, references attached
        json.dumps([{"i": 0, "name": "owl-mascot-back", "what": "the owl mascot seen from behind", "kind": "character", "confidence": 0.85}]),
    ])
    g, c, r = Glossary("test-ref"), Cache("test-ref"), Refs("test-ref")
    results, usage = run_naming([owl_front, owl_back, blob], namer, None, g, c, False, True, True, r)
    by = {x.key: x for x in results}
    assert by["fp-owl-front"].name == "owl-mascot" and by["fp-owl-front"].kind == "character"
    assert by["fp-owl-back"].name == "owl-mascot-back" and by["fp-owl-back"].source == "reference" and usage.reference_matches == 1
    assert by["fp-blob"].name == "" and by["fp-blob"].kind == "abstract" and usage.abstract == 1
    assert usage.calls == 2
    # the front view is now a stored reference for future files, thumbnail included
    stored = Refs("test-ref").all()
    assert stored and stored[0]["name"] == "owl-mascot" and stored[0]["image"] == PNG
    # a later file: the back view alone comes in and is matched against the stored reference on the first pass
    namer2 = FakeListChatModel(responses=[json.dumps([{"i": 0, "name": "owl-mascot-side", "what": "owl mascot in profile", "kind": "character", "confidence": 0.9}])])
    r2, u2 = run_naming([Item(key="fp-owl-side", category="symbol", name="Vector 50", image=PNG)], namer2, None, Glossary("test-ref"), Cache("test-ref"), False, True, True, Refs("test-ref"))
    assert r2[0].name == "owl-mascot-side" and u2.calls == 1

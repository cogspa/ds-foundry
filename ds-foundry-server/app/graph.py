from __future__ import annotations

import json
import re
from typing import Any, Optional, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph

from .glossary import Cache, Glossary, Refs, _slug
from .prompts import CRITIC_SYSTEM, NAMER_SYSTEM, glossary_block
from .schemas import KINDS, Item, NameResult, Proposal, Reference, Usage, Verdict
from .character_parts import character_part

GENERIC = {"icon", "image", "frame", "group", "vector", "rectangle", "shape", "component", "layer", "screen", "card", "element", "item", "picture", "graphic", "button", "text"}
MAX_ROUNDS = 2
REF_KINDS = {"character", "logo"}
RECONCILE_KINDS = {"character", "illustration", "symbol", "abstract"}


class State(TypedDict, total=False):
    items: list[Item]
    references: list[Reference]        # plugin-supplied + stored per project
    pending: list[int]                 # indexes still needing a proposal
    proposals: dict[int, Proposal]
    verdicts: dict[int, Verdict]
    feedback: dict[int, str]           # critic reasons fed back into the next proposal round
    results: dict[int, NameResult]
    round: int
    usage: Usage
    critic: bool
    learn: bool
    use_cache: bool


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    m = re.search(r"\[[\s\S]*\]", text or "")
    if not m:
        raise ValueError("model did not return a JSON array")
    return json.loads(m.group(0))


def _context_line(it: Item, i: int) -> str:
    text = f' · text: "{it.text[:60]}"' if it.text else ""
    geo = f" · geometry: {it.desc}" if it.desc else ""
    return f'#{i} · category: {it.category} · current name: "{it.name}"{geo}{text} · {it.w}×{it.h}px'


def _clean_name(name: str) -> str:
    return _slug(name)


def _message_text(msg: Any) -> str:
    c = getattr(msg, "content", msg)
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in c)
    return str(c)


def _reference_blocks(refs: list[Reference]) -> list[dict[str, Any]]:
    if not refs:
        return []
    out: list[dict[str, Any]] = [{"type": "text", "text": "REFERENCES — characters and logos already named in this project. Do not name these; use them to recognise other views of the same thing."}]
    for n, r in enumerate(refs):
        out.append({"type": "text", "text": f'R{n}: "{r.name}" — {r.what} ({r.kind})'})
        out.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{r.image}"}})
    out.append({"type": "text", "text": "Items to name follow."})
    return out


def _parse_proposals(rows: list[dict[str, Any]], pending: list[int]) -> dict[int, Proposal]:
    out: dict[int, Proposal] = {}
    for row in rows:
        try:
            n = int(row.get("i"))
        except Exception:
            continue
        if n < 0 or n >= len(pending):
            continue
        i = pending[n]
        kind = str(row.get("kind", "") or "")
        if kind not in KINDS:
            kind = ""
        name = _clean_name(str(row.get("name", "") or ""))
        if kind == 'character' and character_part(name): kind = 'symbol'
        conf = float(row.get("confidence", 0.7) or 0.7)
        if kind == "abstract":
            name, conf = "", min(conf, 0.3)
        elif not name or name in GENERIC:
            conf = min(conf, 0.3)
        out[i] = Proposal(i=i, name=name, what=str(row.get("what", ""))[:120], kind=kind, confidence=max(0.0, min(1.0, conf)))
    return out


def build_graph(namer: BaseChatModel, critic: Optional[BaseChatModel], glossary: Glossary, cache: Cache, refs: Optional[Refs] = None):
    """Wire the naming pipeline around injected models so it can run against fakes in tests."""
    refs = refs or Refs("__ephemeral__")

    # ---------------------------------------------------------------- nodes

    def lookup_cache(state: State) -> State:
        items = state["items"]
        results: dict[int, NameResult] = {}
        pending: list[int] = []
        usage = state.get("usage") or Usage()
        for i, it in enumerate(items):
            hit = cache.get(it.key) if state.get("use_cache", True) else None
            if hit:
                results[i] = NameResult(key=it.key, name=hit["name"], what=hit.get("what", ""), kind=hit.get("kind", it.category), confidence=hit.get("confidence", 0.8), source="cache")
                usage.cached += 1
            else:
                pending.append(i)
        # references: what the plugin sent plus what this project has learned, deduped by name
        seen: set[str] = set()
        merged: list[Reference] = []
        for r in list(state.get("references") or []) + [Reference(**{k: v for k, v in row.items() if k in ("name", "what", "kind", "image")}) for row in refs.all()]:
            if r.name in seen or r.kind == 'character' and character_part(r.name):
                continue
            seen.add(r.name)
            merged.append(r)
        return {"results": results, "pending": pending, "usage": usage, "round": 1, "proposals": {}, "verdicts": {}, "feedback": {}, "references": merged[:12]}

    def propose(state: State) -> State:
        pending = state["pending"]
        if not pending:
            return {}
        items = state["items"]
        usage = state["usage"]
        content: list[dict[str, Any]] = []
        for n, i in enumerate(pending):
            it = items[i]
            line = _context_line(it, n)
            fb = state.get("feedback", {}).get(i)
            if fb:
                line += f" · previous attempt rejected: {fb}"
            content.append({"type": "text", "text": line})
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{it.image}"}})
        content.append({"type": "text", "text": f"Name and classify all {len(pending)} images (#0 to #{len(pending) - 1}). JSON array only."})
        content = _reference_blocks(state.get("references") or []) + content
        terms = sorted({t for it in (items[i] for i in pending) for t in glossary.terms(it.category)[:40]})
        msgs = [SystemMessage(content=NAMER_SYSTEM.format(glossary=glossary_block(terms))), HumanMessage(content=content)]
        reply = namer.invoke(msgs)
        usage.calls += 1
        proposals = dict(state.get("proposals", {}))
        try:
            rows = _extract_json_array(_message_text(reply))
        except Exception as e:  # keep going with whatever we have; finalize will fall back
            usage.rounds = state["round"]
            for i in pending:
                proposals.setdefault(i, Proposal(i=i, name="", what=f"parse error: {e}", confidence=0.0))
            return {"proposals": proposals, "usage": usage}
        proposals.update(_parse_proposals(rows, pending))
        for i in pending:
            proposals.setdefault(i, Proposal(i=i, name="", what="no proposal returned", confidence=0.0))
        return {"proposals": proposals, "usage": usage}

    def critique(state: State) -> State:
        pending = state["pending"]
        if not pending or critic is None or not state.get("critic", True):
            return {"verdicts": {i: Verdict(i=i, action="keep") for i in pending}}
        items = state["items"]
        usage = state["usage"]
        lines = []
        for n, i in enumerate(pending):
            it, p = items[i], state["proposals"][i]
            text = f' · text: "{it.text[:60]}"' if it.text else ""
            lines.append(f'#{n} · category: {it.category} · current: "{it.name}"{text} · proposed: "{p.name}" · what: "{p.what}" · confidence: {p.confidence:.2f}')
        terms = sorted({t for it in (items[i] for i in pending) for t in glossary.terms(it.category)[:40]})
        msgs = [SystemMessage(content=CRITIC_SYSTEM.format(glossary=glossary_block(terms))), HumanMessage(content="\n".join(lines) + f"\n\nReview all {len(pending)} items. JSON array only.")]
        reply = critic.invoke(msgs)
        usage.calls += 1
        verdicts: dict[int, Verdict] = {i: Verdict(i=i, action="keep") for i in pending}
        try:
            for row in _extract_json_array(_message_text(reply)):
                n = int(row.get("i", -1))
                if n < 0 or n >= len(pending):
                    continue
                i = pending[n]
                action = row.get("action", "keep")
                name = _clean_name(str(row.get("name") or "")) if action == "rename" else None
                if action == "rename" and (not name or name in GENERIC):
                    action, name = "reject", None
                verdicts[i] = Verdict(i=i, action=action if action in ("keep", "rename", "reject") else "keep", name=name, reason=str(row.get("reason", ""))[:160])
        except Exception:
            pass  # a broken critic reply just means "keep everything"
        # empty or generic proposals are rejected regardless of what the critic said — except deliberate "abstract"
        for i in pending:
            p = state["proposals"][i]
            if p.kind == "abstract":
                verdicts[i] = Verdict(i=i, action="keep")
            elif not p.name or p.name in GENERIC:
                if verdicts[i].action != "rename":
                    verdicts[i] = Verdict(i=i, action="reject", reason=verdicts[i].reason or "empty or generic name")
        return {"verdicts": verdicts, "usage": usage}

    def route_after_critique(state: State) -> str:
        rejected = [i for i in state["pending"] if state["verdicts"][i].action == "reject"]
        if rejected and state["round"] < MAX_ROUNDS:
            return "retry"
        return "align"

    def prepare_retry(state: State) -> State:
        pending = state["pending"]
        verdicts = state["verdicts"]
        results = dict(state["results"])
        feedback: dict[int, str] = {}
        still: list[int] = []
        usage = state["usage"]
        for i in pending:
            v = verdicts[i]
            p = state["proposals"][i]
            it = state["items"][i]
            if v.action == "reject":
                still.append(i)
                feedback[i] = v.reason or "too generic"
            else:
                name = v.name if v.action == "rename" else p.name
                src = "critic" if v.action == "rename" else "model"
                if v.action == "rename":
                    usage.critic_changes += 1
                results[i] = NameResult(key=it.key, name=name, what=p.what, kind=p.kind or it.category, confidence=p.confidence, source=src, note=v.reason if v.action == "rename" else "")
        return {"results": results, "pending": still, "feedback": feedback, "round": state["round"] + 1, "usage": usage}

    def align(state: State) -> State:
        """Fold proposals + verdicts into results, then pull names toward the glossary and dedupe within the batch."""
        items = state["items"]
        results = dict(state["results"])
        usage = state["usage"]
        usage.rounds = state["round"]
        for i in state["pending"]:
            it = items[i]
            p = state["proposals"].get(i) or Proposal(i=i, name="", what="", confidence=0.0)
            v = state["verdicts"].get(i) or Verdict(i=i, action="keep")
            if p.kind == "abstract":
                # the model declined honestly: hand it to the designer, with the geometry description as a hint
                results[i] = NameResult(key=it.key, name="", what=p.what or it.desc or "too abstract to name", kind="abstract", confidence=p.confidence, source="model", note="abstract: needs a human name")
                usage.abstract += 1
                continue
            if v.action == "reject" or not p.name:
                # deterministic fallback so the plugin still gets something reviewable
                fallback = _clean_name(it.text) if it.text else (it.desc or _clean_name(it.name))
                results[i] = NameResult(key=it.key, name=fallback or f"{it.category}-{i + 1}", what=p.what, kind=p.kind or it.category, confidence=0.2, source="model", note=f"unresolved: {v.reason or 'no usable proposal'}")
                continue
            name = v.name if v.action == "rename" else p.name
            src = "critic" if v.action == "rename" else "model"
            if v.action == "rename":
                usage.critic_changes += 1
            results[i] = NameResult(key=it.key, name=name, what=p.what, kind=p.kind or it.category, confidence=p.confidence, source=src, note=v.reason if v.action == "rename" else "")

        # glossary alignment: reuse an existing term when it clearly means the same thing
        for i, r in results.items():
            if r.source == "cache" or r.confidence < 0.2 or not r.name:
                continue
            it = items[i]
            hit = glossary.similar(it.category, r.name, r.what)
            if hit and hit.name != r.name:
                r.note = (r.note + "; " if r.note else "") + f"aligned to glossary term (was {r.name})"
                r.name = hit.name
                r.source = "glossary"
                usage.glossary_hits += 1

        # within-batch uniqueness per category, but identical keys may legitimately share a name
        seen: dict[str, str] = {}
        for i in sorted(results):
            r, it = results[i], items[i]
            if not r.name:
                continue
            k = f"{it.category}|{r.name}"
            if k in seen and seen[k] != it.key:
                n = 2
                while f"{it.category}|{r.name}-{n}" in seen:
                    n += 1
                r.name = f"{r.name}-{n}"
                k = f"{it.category}|{r.name}"
            seen.setdefault(k, it.key)
        return {"results": results, "usage": usage}

    def reconcile(state: State) -> State:
        """Second look: items that might be another view of a known character/logo, judged against references
        (stored + plugin-supplied + anything named confidently in this very batch)."""
        items = state["items"]
        results = state["results"]
        usage = state["usage"]
        refs: list[Reference] = list(state.get("references") or [])
        seen = {r.name for r in refs}
        for i, r in results.items():
            if r.name and r.kind in REF_KINDS and r.confidence >= 0.8 and r.name not in seen:
                refs.append(Reference(name=r.name, what=r.what, kind=r.kind, image=items[i].image))
                seen.add(r.name)
        refs = refs[:8]
        cands = [i for i, r in results.items() if (r.kind in RECONCILE_KINDS or items[i].category in RECONCILE_KINDS) and r.source != "cache" and (not r.name or r.confidence < 0.7) and r.name not in seen]
        if not refs or not cands:
            return {}
        for start in range(0, len(cands), 8):
            pend = cands[start:start + 8]
            content: list[dict[str, Any]] = _reference_blocks(refs)
            for n, i in enumerate(pend):
                it = items[i]
                content.append({"type": "text", "text": _context_line(it, n) + (f' · earlier proposal: "{results[i].name}" ({results[i].what})' if results[i].name else " · earlier attempt: abstract")})
                content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{it.image}"}})
            content.append({"type": "text", "text": f"Decide for each of the {len(pend)} items whether it is another view of a reference. If yes, name it <reference-name>-<view>. If not, name it on its own merits or mark it abstract. JSON array only."})
            reply = namer.invoke([SystemMessage(content=NAMER_SYSTEM.format(glossary="")), HumanMessage(content=content)])
            usage.calls += 1
            try:
                props = _parse_proposals(_extract_json_array(_message_text(reply)), pend)
            except Exception:
                continue
            for i, p in props.items():
                r = results[i]
                if p.kind == "abstract" or not p.name:
                    continue
                if p.name == r.name and p.confidence <= r.confidence:
                    continue
                matched = any(p.name.startswith(ref.name + "-") or p.name == ref.name for ref in refs)
                r.name, r.what, r.kind, r.confidence = p.name, p.what or r.what, p.kind or r.kind, p.confidence
                r.source = "reference" if matched else r.source
                r.note = "matched to a reference" if matched else r.note
                if matched:
                    usage.reference_matches += 1
        return {"results": results, "usage": usage}

    def finalize(state: State) -> State:
        items = state["items"]
        for i, r in state["results"].items():
            it = items[i]
            if r.source == "cache" or not r.name or r.confidence < 0.5 or r.note.startswith("unresolved"):
                continue
            cache.put(it.key, {"name": r.name, "what": r.what, "kind": r.kind, "confidence": r.confidence})
            if state.get("learn", True):
                glossary.learn(it.category, r.name, r.what)
                if r.kind in REF_KINDS and r.confidence >= 0.8 and not (r.kind == 'character' and character_part(r.name)):
                    refs.add(r.name, r.what, r.kind, it.image)
        cache.save()
        if state.get("learn", True):
            glossary.save()
            refs.save()
        return {}

    # ---------------------------------------------------------------- graph

    g = StateGraph(State)
    g.add_node("lookup_cache", lookup_cache)
    g.add_node("propose", propose)
    g.add_node("critique", critique)
    g.add_node("prepare_retry", prepare_retry)
    g.add_node("align", align)
    g.add_node("reconcile", reconcile)
    g.add_node("finalize", finalize)

    g.set_entry_point("lookup_cache")
    g.add_edge("lookup_cache", "propose")
    g.add_edge("propose", "critique")
    g.add_conditional_edges("critique", route_after_critique, {"retry": "prepare_retry", "align": "align"})
    g.add_edge("prepare_retry", "propose")
    g.add_edge("align", "reconcile")
    g.add_edge("reconcile", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


def run_naming(items: list[Item], namer: BaseChatModel, critic: Optional[BaseChatModel], glossary: Glossary, cache: Cache, use_critic: bool, learn: bool, use_cache: bool, refs: Optional[Refs] = None, references: Optional[list[Reference]] = None) -> tuple[list[NameResult], Usage]:
    graph = build_graph(namer, critic, glossary, cache, refs)
    final = graph.invoke({"items": items, "references": references or [], "critic": use_critic, "learn": learn, "use_cache": use_cache, "usage": Usage()})
    results = [final["results"][i] for i in range(len(items))]
    return results, final["usage"]

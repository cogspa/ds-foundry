from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional

from .schemas import GlossaryEntry

DATA_DIR = Path(os.environ.get("DSF_DATA_DIR", "data"))
_lock = threading.Lock()

_STOP = {"a", "an", "the", "of", "with", "and", "on", "in", "for", "to", "outline", "filled", "solid", "line", "style"}


def _tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", s.lower()) if t and t not in _STOP}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")[:40]


class Glossary:
    """Names already accepted for a project, per category, with the descriptions that earned them.

    Matching is deliberately simple: token overlap between the new name+description and each entry's
    name+aliases+description. It keeps "search" from drifting to "magnifier" without needing an embedding model.
    Swap `similar()` for a vector lookup if you outgrow it.
    """

    def __init__(self, project: str):
        self.path = DATA_DIR / "glossary" / f"{_slug(project) or 'default'}.json"
        self.entries: dict[str, GlossaryEntry] = {}
        self._load()

    def _key(self, category: str, name: str) -> str:
        return f"{category}|{name}"

    def _load(self) -> None:
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text())
                self.entries = {self._key(e["category"], e["name"]): GlossaryEntry(**e) for e in raw}
            except Exception:
                self.entries = {}

    def save(self) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps([e.model_dump() for e in self.entries.values()], indent=2))

    def terms(self, category: Optional[str] = None) -> list[str]:
        out = [e for e in self.entries.values() if category is None or e.category == category]
        out.sort(key=lambda e: -e.uses)
        return [e.name for e in out]

    def similar(self, category: str, name: str, what: str, threshold: float = 0.5) -> Optional[GlossaryEntry]:
        """Return the closest existing entry in the same category, if it is close enough."""
        probe = _tokens(name) | _tokens(what)
        best, score = None, 0.0
        for e in self.entries.values():
            if e.category != category:
                continue
            if e.name == name:
                return e
            ref = _tokens(e.name) | _tokens(e.what) | {t for a in e.aliases for t in _tokens(a)}
            s = _jaccard(probe, ref)
            # exact name-token containment is a strong signal on its own
            if _tokens(e.name) and _tokens(e.name) <= _tokens(name):
                s = max(s, 0.75)
            if s > score:
                best, score = e, s
        return best if best and score >= threshold else None

    def learn(self, category: str, name: str, what: str, alias: Optional[str] = None) -> None:
        k = self._key(category, name)
        e = self.entries.get(k)
        if e:
            e.uses += 1
            if alias and alias != name and alias not in e.aliases:
                e.aliases.append(alias)
            if not e.what and what:
                e.what = what
        else:
            self.entries[k] = GlossaryEntry(category=category, name=name, what=what, aliases=[alias] if alias and alias != name else [], uses=1)

    def upsert(self, entry: GlossaryEntry) -> None:
        self.entries[self._key(entry.category, entry.name)] = entry

    def remove(self, category: str, name: str) -> bool:
        return self.entries.pop(self._key(category, name), None) is not None


class Refs:
    """Confidently named characters and logos, with thumbnails, so later batches and later files can
    recognise their other views. Capped per project; most-used first."""

    MAX = 24

    def __init__(self, project: str):
        self.path = DATA_DIR / "refs" / f"{_slug(project) or 'default'}.json"
        self.rows: list[dict] = []
        if self.path.exists():
            try:
                self.rows = json.loads(self.path.read_text())
            except Exception:
                self.rows = []

    def all(self) -> list[dict]:
        return sorted(self.rows, key=lambda r: -r.get("uses", 0))[: self.MAX]

    def add(self, name: str, what: str, kind: str, image: str) -> None:
        for r in self.rows:
            if r["name"] == name:
                r["uses"] = r.get("uses", 0) + 1
                if what and not r.get("what"):
                    r["what"] = what
                return
        self.rows.append({"name": name, "what": what, "kind": kind, "image": image, "uses": 1, "ts": int(time.time())})
        self.rows = sorted(self.rows, key=lambda r: -r.get("uses", 0))[: self.MAX * 2]

    def save(self) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.rows))


class Cache:
    """fingerprint → accepted result, per project. Re-running on a file you've named is free."""

    def __init__(self, project: str):
        self.path = DATA_DIR / "cache" / f"{_slug(project) or 'default'}.json"
        self.rows: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.rows = json.loads(self.path.read_text())
            except Exception:
                self.rows = {}

    def get(self, key: str) -> Optional[dict]:
        return self.rows.get(key)

    def put(self, key: str, value: dict) -> None:
        self.rows[key] = {**value, "ts": int(time.time())}

    def save(self) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.rows))

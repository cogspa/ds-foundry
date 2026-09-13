"""Approval-only project memory. SQLite transactions avoid partial writes and lost concurrent updates."""
from __future__ import annotations
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from . import glossary
from .asset_schemas import ApprovalRequest, AssetItem

class AssetStore:
    def __init__(self, project: str):
        self.project = project
        self.path = glossary.DATA_DIR / 'canonical-assets.sqlite3'

    @contextmanager
    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        db.execute('CREATE TABLE IF NOT EXISTS families (project TEXT, id TEXT, data TEXT, PRIMARY KEY(project,id))')
        db.execute('CREATE TABLE IF NOT EXISTS rejected (project TEXT, a TEXT, b TEXT, PRIMARY KEY(project,a,b))')
        try:
            with db:
                yield db
        finally:
            db.close()

    def all(self):
        if not self.path.exists(): return []
        with self._connect() as db:
            return [json.loads(r[0]) for r in db.execute('SELECT data FROM families WHERE project=? ORDER BY id', (self.project,))]

    def rejected(self):
        if not self.path.exists(): return set()
        with self._connect() as db:
            return {tuple(r) for r in db.execute('SELECT a,b FROM rejected WHERE project=?', (self.project,))}

    def approve(self, req: ApprovalRequest):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for f in req.families:
                old = db.execute('SELECT data FROM families WHERE project=? AND id=?', (self.project, f.assetId)).fetchone()
                previous = json.loads(old[0]) if old else {}
                if previous and previous['kind'] != f.kind: raise ValueError('existing asset kind cannot change')
                samples = previous.get('samples', [])
                for superseded in f.supersedes:
                    merged = db.execute('SELECT data FROM families WHERE project=? AND id=?', (self.project,superseded)).fetchone()
                    if merged:
                        other = json.loads(merged[0])
                        if other['kind'] != f.kind: raise ValueError('cannot merge different asset categories')
                        samples += other.get('samples', [])
                        previous.setdefault('aliases', []).extend([other['canonicalName'], *other.get('aliases',[])])
                # Replace this document's samples: splitting must remove the old membership.
                submitted = {v.nodeId for family in req.families for v in family.variants}
                samples = [s for s in samples if not (s.get('documentId') == req.documentId and s['item']['nodeId'] in submitted)]
                for v in sorted(f.variants, key=lambda v: v.nodeId != f.referenceNodeId):
                    item = v.model_dump(include=set(AssetItem.model_fields))
                    item['layout'] = None
                    item['features']['variant'] = v.variant.model_dump(exclude_none=True)
                    samples.append({'documentId': req.documentId, 'item': item})
                # Keep multiple treatments but dedupe repeated appearances; reference is first among new samples.
                unique = {}
                for s in reversed(samples):
                    it = s['item']; key = hashlib.sha256(json.dumps([it['features'], it.get('image','')], sort_keys=True).encode()).hexdigest()
                    unique[key] = s
                row = {'assetId': f.assetId, 'canonicalName': f.canonicalName, 'kind': f.kind,
                       'aliases': sorted(set(previous.get('aliases', []) + f.aliases + [previous.get('canonicalName', f.canonicalName)])),
                       'reference': {'documentId':req.documentId,'nodeId':f.referenceNodeId}, 'brandFamily': f.brandFamily, 'samples': sorted(unique.values(), key=lambda s: not (s.get('documentId')==req.documentId and s['item']['nodeId']==f.referenceNodeId))[:64]}
                db.execute('INSERT OR REPLACE INTO families VALUES (?,?,?)', (self.project, f.assetId, json.dumps(row)))
                for superseded in f.supersedes:
                    db.execute('DELETE FROM families WHERE project=? AND id=?', (self.project, superseded))
            # Remove reassigned nodes from every other family in this project, preserving other files.
            owners = {v.nodeId: f.assetId for f in req.families for v in f.variants}
            for fid, raw in db.execute('SELECT id,data FROM families WHERE project=?', (self.project,)).fetchall():
                row = json.loads(raw)
                row['samples'] = [s for s in row['samples'] if not (s.get('documentId') == req.documentId and s['item']['nodeId'] in owners and owners[s['item']['nodeId']] != fid)]
                db.execute('UPDATE families SET data=? WHERE project=? AND id=?', (json.dumps(row), self.project, fid))
            for a,b in req.rejected:
                a,b = sorted((a,b))
                if a != b: db.execute('INSERT OR IGNORE INTO rejected VALUES (?,?,?)', (self.project,a,b))

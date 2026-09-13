"""Explicitly approved references, separate from automatic naming history."""
import hashlib
import re
import base64
import json
import sqlite3
import uuid
from contextlib import contextmanager
from typing import Annotated, Literal
from pydantic import BaseModel, Field, field_validator
from . import glossary

Short = Annotated[str, Field(max_length=100)]
class Features(BaseModel):
    geometry: str | None = Field(default=None, max_length=100)
    parts: list[Short] = Field(default_factory=list, max_length=512)
    palette: list[Short] = Field(default_factory=list, max_length=2048)
    stroke: float = Field(default=0, ge=0, le=100000)
    width: float = Field(gt=0, le=10000000)
    height: float = Field(gt=0, le=10000000)
    complete: bool = False

class Appearance(BaseModel):
    color: str = Field(default='',max_length=30)
    pose: str = Field(default='',max_length=30)
    crop: str = Field(default='',max_length=30)
    treatment: str = Field(default='',max_length=30)
    orientation: str = Field(default='',max_length=30)
    @field_validator('*')
    @classmethod
    def slug(cls,v): return re.sub(r'[^a-z0-9]+','-',v.strip().lower()).strip('-')

class AssetName(BaseModel):
    identity: str = Field(min_length=1,max_length=40)
    appearance: Appearance = Field(default_factory=Appearance)
    @field_validator('identity')
    @classmethod
    def slug(cls,v):
        v=re.sub(r'[^a-z0-9]+','-',v.strip().lower()).strip('-')
        if not v: raise ValueError('Enter an identity')
        return v
    def generated_name(self):
        return '-'.join([self.identity]+[v for v in self.appearance.model_dump().values() if v])

class LogoRegion(BaseModel):
    id: str = Field(max_length=100)
    name: str = Field(max_length=500)
    text: str = Field(default='',max_length=200)
    role: Literal['symbol','signature','ignore']
    x: float = Field(ge=-10,le=10,allow_inf_nan=False)
    y: float = Field(ge=-10,le=10,allow_inf_nan=False)
    width: float = Field(ge=0,le=20,allow_inf_nan=False)
    height: float = Field(ge=0,le=20,allow_inf_nan=False)
    features: Features | None = None

class LogoComposition(BaseModel):
    version: Literal[1] = 1
    arrangement: Literal['horizontal','stacked','overlapping','signature-only','symbol-only']
    regions: list[LogoRegion] = Field(min_length=1,max_length=48)

class LibraryEntry(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    assetName: AssetName | None = None
    kind: str = Field(min_length=1, max_length=40)
    what: str = Field(default='', max_length=500)
    image: str = Field(min_length=1, max_length=1000000)
    features: Features | None = None
    composition: LogoComposition | None = None
    @field_validator('name')
    @classmethod
    def clean_name(cls, v):
        v=v.strip()
        if not v: raise ValueError('Enter a reference name')
        return v
    @field_validator('image')
    @classmethod
    def png(cls,v):
        raw=base64.b64decode(v,validate=True)
        if not raw.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Expected a PNG thumbnail')
        return v

class Rename(BaseModel):
    name: str = Field(min_length=1,max_length=200)
    assetName: AssetName | None = None
    @field_validator('name')
    @classmethod
    def clean(cls,v):
        if not v.strip(): raise ValueError('Enter a name')
        return v.strip()

class ReferenceLibrary:
    def __init__(self, project): self.project=project
    @contextmanager
    def db(self):
        glossary.DATA_DIR.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(glossary.DATA_DIR/'approved-references.sqlite3',timeout=10)
        db.execute('CREATE TABLE IF NOT EXISTS refs (project TEXT,id TEXT,data TEXT,PRIMARY KEY(project,id))')
        db.execute('CREATE TABLE IF NOT EXISTS rejections (project TEXT,id TEXT,data TEXT,PRIMARY KEY(project,id))')
        try:
            db.execute('BEGIN IMMEDIATE')
            with db: yield db
        finally: db.close()
    def all(self):
        with self.db() as db:
            return [dict(json.loads(data),id=id) for id,data in db.execute('SELECT id,data FROM refs WHERE project=? ORDER BY rowid',(self.project,))]
    def save(self, entry):
        if entry.assetName: entry.name=entry.assetName.generated_name()
        data=entry.model_dump(exclude_none=True)
        with self.db() as db:
            rows=list(db.execute('SELECT id,data FROM refs WHERE project=?',(self.project,)))
            id=next((id for id,old in rows if (o:=json.loads(old))['name']==entry.name and o['kind']==entry.kind),None)
            if not id and len(rows)>=64: raise ValueError('Reference library is full (64 entries). Remove an unused reference first.')
            id=id or str(uuid.uuid4())
            db.execute('INSERT OR REPLACE INTO refs VALUES (?,?,?)',(self.project,id,json.dumps(data)))
            return dict(data,id=id)
    def rename(self,id,name,asset_name=None):
        with self.db() as db:
            row=db.execute('SELECT data FROM refs WHERE project=? AND id=?',(self.project,id)).fetchone()
            if not row:return False
            data=json.loads(row[0]);name=asset_name.generated_name() if asset_name else name;data['name']=name
            data['assetName']=asset_name.model_dump() if asset_name else None
            for other,raw in db.execute('SELECT id,data FROM refs WHERE project=?',(self.project,)):
                d=json.loads(raw)
                if other!=id and d['name']==name and d['kind']==data['kind']:raise ValueError('That name already exists for this kind.')
            db.execute('UPDATE refs SET data=? WHERE project=? AND id=?',(json.dumps(data),self.project,id));return True
    def delete(self,id):
        with self.db() as db:return db.execute('DELETE FROM refs WHERE project=? AND id=?',(self.project,id)).rowcount>0


class RejectedMatch(BaseModel):
    a: str = Field(min_length=1,max_length=100)
    b: str = Field(min_length=1,max_length=100)
    aName: str = Field(default='',max_length=200)
    bName: str = Field(default='',max_length=200)

class RejectionStore(ReferenceLibrary):
    def all(self):
        with self.db() as db:return [dict(json.loads(raw),id=id) for id,raw in db.execute('SELECT id,data FROM rejections WHERE project=?',(self.project,))]
    def save(self,entry):
        id=hashlib.sha256(json.dumps(sorted([entry.a,entry.b])).encode()).hexdigest()
        with self.db() as db:
            count=db.execute('SELECT count(*) FROM rejections WHERE project=?',(self.project,)).fetchone()[0]
            exists=db.execute('SELECT 1 FROM rejections WHERE project=? AND id=?',(self.project,id)).fetchone()
            if count>=5000 and not exists:raise ValueError('Rejected-match limit reached. Forget unused decisions first.')
            db.execute('INSERT OR REPLACE INTO rejections VALUES (?,?,?)',(self.project,id,entry.model_dump_json()))
        return dict(entry.model_dump(),id=id)
    def delete(self,id):
        with self.db() as db:return db.execute('DELETE FROM rejections WHERE project=? AND id=?',(self.project,id)).rowcount>0

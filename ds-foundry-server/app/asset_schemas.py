"""Versioned canonical contract. Naming API shapes remain unchanged."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator
from .schemas import Provider

Category = Literal['screen','section','nav','card','button','input','badge','avatar','image','icon','divider','list-item','checkbox','toggle','text','shape','logo','character','illustration','symbol','tagline','copy','debris','other']
class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class VariantProperties(Model):
    color: str | None = Field(None, max_length=60)
    orientation: str | None = Field(None, max_length=60)
    treatment: str | None = Field(None, max_length=60)
    lockup: str | None = Field(None, max_length=60)
    state: str | None = Field(None, max_length=60)
    crop: str | None = Field(None, max_length=60)
    pose: str | None = Field(None, max_length=60)

class Features(Model):
    version: Literal[1] = 1
    geometrySignature: str | None = Field(None, max_length=100)
    geometryReliable: bool = False
    visualSignature: str | None = Field(None, max_length=200)
    visibleText: str = Field('', max_length=200)
    componentFamily: str | None = Field(None, max_length=200)
    variant: VariantProperties = Field(default_factory=VariantProperties)
    warnings: list[str] = Field(default_factory=list)

class AssetItem(Model):
    nodeId: str = Field(min_length=1, max_length=200)
    kind: Category
    name: str = Field('', max_length=500)
    semanticName: str = Field('', max_length=200)
    description: str = Field('', max_length=500)
    fingerprint: str = Field('', max_length=4000)
    width: float = Field(0, ge=0)
    height: float = Field(0, ge=0)
    page: str = Field('', max_length=500)
    features: Features
    layout: dict | None = None
    image: str = Field('', max_length=1_500_000)
    approvedAssetId: str | None = Field(None, max_length=200)
    approvedVariant: VariantProperties | None = None

class AssetVariant(AssetItem):
    assetId: str
    canonicalName: str
    variantId: str
    variant: VariantProperties
    identityConfidence: float = Field(ge=0, le=1)
    identityEvidence: list[str]
    aspectRatio: float = Field(ge=0)

class AssetFamily(Model):
    assetId: str = Field(min_length=1, max_length=200, pattern=r'^[a-z0-9][a-z0-9/_-]*$')
    canonicalName: str = Field(min_length=1, max_length=120)
    kind: Category
    variants: list[AssetVariant] = Field(default_factory=list, max_length=10000)
    confidence: float = Field(ge=0, le=1)
    aliases: list[str] = Field(default_factory=list, max_length=100)
    referenceNodeId: str | None = None
    brandFamily: str | None = Field(None, max_length=120)
    status: Literal['pending','approved'] = 'pending'
    supersedes: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def consistent(self):
        ids = [v.nodeId for v in self.variants]
        if len(ids) != len(set(ids)): raise ValueError('duplicate variant nodes')
        if self.referenceNodeId and self.referenceNodeId not in ids: raise ValueError('reference must be a member')
        if any(v.assetId != self.assetId or v.kind != self.kind or v.canonicalName != self.canonicalName for v in self.variants):
            raise ValueError('variant/family identity mismatch')
        return self

class AssetProposal(Model):
    left: str
    right: str
    confidence: float = Field(ge=0, le=1)
    evidence: list[str]
    relation: Literal['same','related','uncertain']
    canonicalName: str = ''

class AssetMap(Model):
    schemaVersion: Literal[1] = 1
    documentId: str
    assets: list[AssetFamily]
    proposals: list[AssetProposal] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    calls: int = 0
    candidateCount: int = 0

class ResolveRequest(Model):
    project: str = Field('default', min_length=1, max_length=120)
    documentId: str = Field(min_length=1, max_length=200)
    items: list[AssetItem] = Field(max_length=10000)
    useModel: bool = False
    provider: Provider = 'anthropic'
    model: str | None = None
    api_key: str | None = None
    maxModelCalls: int = Field(8, ge=0, le=30)

    @model_validator(mode='after')
    def unique_nodes(self):
        if len({i.nodeId for i in self.items}) != len(self.items): raise ValueError('duplicate node IDs')
        return self

class ApprovalRequest(Model):
    documentId: str = Field(min_length=1, max_length=200)
    families: list[AssetFamily] = Field(max_length=10000)
    rejected: list[tuple[str,str]] = Field(default_factory=list, max_length=10000)

    @model_validator(mode='after')
    def approved_partition(self):
        if any(f.status != 'approved' or not f.variants for f in self.families): raise ValueError('only nonempty approved families can be saved')
        ids = [v.nodeId for f in self.families for v in f.variants]
        if len(ids) != len(set(ids)): raise ValueError('a node can belong to only one family')
        fids = [f.assetId for f in self.families]
        if len(fids) != len(set(fids)): raise ValueError('duplicate families')
        if any(old in fids for f in self.families for old in f.supersedes): raise ValueError('cannot supersede another submitted family')
        return self

class IdentityVerdict(Model):
    relation: Literal['same','different','related','uncertain']
    confidence: float = Field(ge=0, le=1)
    canonicalName: str = Field('', max_length=120)
    evidence: list[str] = Field(min_length=1, max_length=12)
    leftVariant: VariantProperties = Field(default_factory=VariantProperties)
    rightVariant: VariantProperties = Field(default_factory=VariantProperties)

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Provider = Literal["anthropic", "gemini", "ollama"]

KINDS = ["icon", "symbol", "logo", "character", "illustration", "image", "avatar", "screen", "section", "nav", "card", "list-item", "button", "badge", "input", "tagline", "copy", "shape", "debris", "abstract"]


class Item(BaseModel):
    """One layer thumbnail the plugin wants named."""

    key: str = Field(description="Fingerprint or node id; used for caching and for mapping results back")
    category: str = Field(description="icon | image | avatar | screen | section | nav | card | list-item | component | shape")
    name: str = Field(default="", description="Current layer name")
    desc: str = Field(default="", description="Geometry description from the plugin, e.g. navy-outline-blob-56x30")
    text: str = Field(default="", description="Text found inside the layer, if any")
    w: int = 0
    h: int = 0
    image: str = Field(description="Base64 PNG, no data-URL prefix")

    @field_validator("image")
    @classmethod
    def strip_prefix(cls, v: str) -> str:
        return v.split(",", 1)[1] if v.startswith("data:") else v


class Reference(BaseModel):
    """An already-named character or logo the model should recognise other views of."""

    name: str
    what: str = ""
    kind: str = "character"
    image: str = Field(description="Base64 PNG")

    @field_validator("image")
    @classmethod
    def strip_prefix(cls, v: str) -> str:
        return v.split(",", 1)[1] if v.startswith("data:") else v


class NameRequest(BaseModel):
    provider: Provider = "anthropic"
    model: Optional[str] = Field(default=None, description="Model id; server default for the provider when omitted")
    api_key: Optional[str] = Field(default=None, description="Optional per-request key; falls back to server env")
    items: list[Item] = Field(min_length=1, max_length=40)
    critic: bool = Field(default=True, description="Run the critic pass")
    learn: bool = Field(default=True, description="Add accepted names to the glossary")
    excluded_reference_names: list[str] = Field(default_factory=list,max_length=10000)
    use_cache: bool = True
    project: str = Field(default="default", description="Glossary/cache namespace")
    references: list[Reference] = Field(default_factory=list, description="Optional references from the plugin; the server also keeps its own per project")


class Proposal(BaseModel):
    i: int
    name: str
    what: str = ""
    kind: str = ""
    confidence: float = Field(default=0.7, ge=0, le=1)


class Verdict(BaseModel):
    i: int
    action: Literal["keep", "rename", "reject"] = "keep"
    name: Optional[str] = None
    reason: str = ""


class NameResult(BaseModel):
    key: str
    name: str = Field(default="", description="Empty when kind is 'abstract': the designer should name it")
    what: str = ""
    kind: str = ""
    confidence: float = 0.7
    source: Literal["model", "cache", "glossary", "critic", "reference"] = "model"
    note: str = ""


class Usage(BaseModel):
    calls: int = 0
    cached: int = 0
    glossary_hits: int = 0
    critic_changes: int = 0
    reference_matches: int = 0
    abstract: int = 0
    rounds: int = 1


class NameResponse(BaseModel):
    results: list[NameResult]
    usage: Usage


class GlossaryEntry(BaseModel):
    category: str
    name: str
    what: str = ""
    aliases: list[str] = Field(default_factory=list)
    uses: int = 0

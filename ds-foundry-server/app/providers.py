from __future__ import annotations

import os
from typing import Optional

from langchain_core.language_models import BaseChatModel

DEFAULT_PROVIDER = os.environ.get("DSF_DEFAULT_PROVIDER", "gemini")

DEFAULT_MODELS = {
    "gemini": os.environ.get("DSF_GEMINI_MODEL", "gemini-3.7-flash"),
    "anthropic": os.environ.get("DSF_ANTHROPIC_MODEL", "claude-sonnet-5"),
    "ollama": os.environ.get("DSF_OLLAMA_MODEL", "llama3.2-vision"),
}

# a cheaper text-only model for the critic pass, per provider (falls back to the namer model)
CRITIC_MODELS = {
    "gemini": os.environ.get("DSF_GEMINI_CRITIC", "gemini-3.5-flash-lite"),
    "anthropic": os.environ.get("DSF_ANTHROPIC_CRITIC", "claude-haiku-4-5"),
    "ollama": os.environ.get("DSF_OLLAMA_CRITIC", ""),
}


def configured_providers() -> dict[str, bool]:
    return {
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "gemini": bool(os.environ.get("GOOGLE_API_KEY")),
        "ollama": True,
    }


def get_chat_model(provider: str, model: Optional[str] = None, api_key: Optional[str] = None, temperature: float = 0.2, max_tokens: int = 2048) -> BaseChatModel:
    model = model or DEFAULT_MODELS[provider]
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs = {"model": model, "temperature": temperature, "max_tokens": max_tokens}
        if api_key:
            kwargs["api_key"] = api_key
        return ChatAnthropic(**kwargs)
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        kwargs = {"model": model, "temperature": temperature, "max_output_tokens": max_tokens}
        if api_key:
            kwargs["google_api_key"] = api_key
        return ChatGoogleGenerativeAI(**kwargs)
    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=model, temperature=temperature, base_url=os.environ.get("OLLAMA_HOST", "http://localhost:11434"))
    raise ValueError(f"unknown provider {provider}")


def get_critic_model(provider: str, model: Optional[str], api_key: Optional[str]) -> BaseChatModel:
    critic = CRITIC_MODELS.get(provider) or model
    return get_chat_model(provider, critic, api_key, temperature=0.0, max_tokens=1500)

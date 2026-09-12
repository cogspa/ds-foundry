# Changelog

## 0.2.0 — 2026-09-12

- `kind` on proposals and results; `abstract` results left unnamed for the designer (`usage.abstract`).
- Per-project **references** with thumbnails (`Refs`), sent to the namer on every batch; new `reconcile` node re-examines low-confidence characters/illustrations/symbols against them (`source: reference`, `usage.reference_matches`).
- `/references/{project}` endpoints. Item `desc` (geometry description) passed through as context.

## 0.1.0 — 2026-09-11

First release: `/name` pipeline (cache → propose → critic → retry → glossary align → dedupe → learn), `/glossary` CRUD, `/cache` clear, `/health`. Providers: Claude, Gemini, Ollama. Tests with fake models.

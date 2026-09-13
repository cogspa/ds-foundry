#!/bin/sh
# Run explicitly after changes; the live benchmark uses the configured provider API.
set -eu
cd "$(dirname "$0")/.."
npm --prefix ../ds-foundry run check
.venv/bin/pytest -q
.venv/bin/python tools/evaluate_artwork.py --live --provider gemini --baseline evaluations/artwork/baseline.json "$@"
.venv/bin/python tools/evaluate_logos.py

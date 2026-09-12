#!/usr/bin/env bash
# One-shot: create venv, install, run on :8000 with reload.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] && set -a && source .env && set +a
exec uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}" --reload

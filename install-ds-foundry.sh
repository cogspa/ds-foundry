#!/usr/bin/env bash
# install-ds-foundry.sh — installs, updates and controls the DS Foundry plugin + naming server on macOS.
#
#   ./install-ds-foundry.sh                       # install/update both from the newest zips next to this script (or ~/Downloads)
#   ./install-ds-foundry.sh install --launchd     # same, and register the server to start at login
#   ./install-ds-foundry.sh start|stop|status|logs|test
#
# Options for install:
#   --plugin <zip>        path to ds-foundry-vX.Y.Z.zip           (default: newest found)
#   --server <zip>        path to ds-foundry-server-vX.Y.Z.zip    (default: newest found)
#   --dest <dir>          install root                            (default: ~/Figma Plugins)
#   --anthropic-key <k>   write ANTHROPIC_API_KEY into the server .env (or set the env var before running)
#   --gemini-key <k>      write GOOGLE_API_KEY into the server .env    (or set GOOGLE_API_KEY)
#   --port <n>            server port                             (default: 8000 — matches the plugin's devAllowedDomains)
#   --launchd             run the server as a login item via launchd instead of a background process
#   --ollama              pull llama3.2-vision and install langchain-ollama for local naming
#   --test                run the server's pytest suite after install (no tokens spent)
#   --no-start            install only
#   --no-figma            don't open Figma at the end
#
# Everything is idempotent: re-running updates code in place and keeps .env, data/ (glossary + cache) and .venv.

set -euo pipefail

DEST="${DS_FOUNDRY_HOME:-$HOME/Figma Plugins}"
PORT=8000
PLUGIN_ZIP=""; SERVER_ZIP=""
ANTHROPIC="${ANTHROPIC_API_KEY:-}"; GEMINI="${GOOGLE_API_KEY:-}"
USE_LAUNCHD=0; WANT_OLLAMA=0; RUN_TESTS=0; START=1; OPEN_FIGMA=1
LABEL="com.cogspa.ds-foundry-server"

CMD="install"
if [[ $# -gt 0 && "$1" != --* ]]; then CMD="$1"; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --plugin) PLUGIN_ZIP="$2"; shift 2;;
    --server) SERVER_ZIP="$2"; shift 2;;
    --dest) DEST="$2"; shift 2;;
    --anthropic-key) ANTHROPIC="$2"; shift 2;;
    --gemini-key) GEMINI="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --launchd) USE_LAUNCHD=1; shift;;
    --ollama) WANT_OLLAMA=1; shift;;
    --test) RUN_TESTS=1; shift;;
    --no-start) START=0; shift;;
    --no-figma) OPEN_FIGMA=0; shift;;
    -h|--help) sed -n '2,24p' "$0"; exit 0;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

SERVER_DIR="$DEST/ds-foundry-server"
PLUGIN_DIR="$DEST/ds-foundry"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PIDFILE="$SERVER_DIR/server.pid"
LOG="$SERVER_DIR/server.log"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- helpers

newest_zip() { # newest_zip <prefix>  → path of highest-version zip found next to the script or in ~/Downloads
  local here; here="$(cd "$(dirname "$0")" && pwd)"
  ls -1 "$here"/"$1"-v*.zip "$HOME"/Downloads/"$1"-v*.zip 2>/dev/null | sort -t v -k2 -V | tail -n1 || true
}

py_ok() { # python 3.11+
  have python3 || return 1
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
}

health() { curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null; }

server_running() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then return 0; fi
  health >/dev/null 2>&1
}

wait_healthy() {
  local i; for i in $(seq 1 40); do
    if health >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

unpack_server() {
  [[ -f "$SERVER_ZIP" ]] || die "server zip not found: ${SERVER_ZIP:-<none>} (pass --server <zip>)"
  local keep; keep="$(mktemp -d)"
  if [[ -d "$SERVER_DIR" ]]; then
    for k in .env data .venv; do [[ -e "$SERVER_DIR/$k" ]] && mv "$SERVER_DIR/$k" "$keep/"; done
    rm -rf "$SERVER_DIR"
  fi
  mkdir -p "$DEST"
  local tmp; tmp="$(mktemp -d)"
  unzip -q "$SERVER_ZIP" -d "$tmp"
  mv "$tmp/ds-foundry-server" "$SERVER_DIR"; rm -rf "$tmp"
  for k in .env data .venv; do [[ -e "$keep/$k" ]] && rm -rf "$SERVER_DIR/$k" && mv "$keep/$k" "$SERVER_DIR/"; done
  rm -rf "$keep"
  ok "server unpacked → $SERVER_DIR ($(basename "$SERVER_ZIP"))"
}

unpack_plugin() {
  [[ -f "$PLUGIN_ZIP" ]] || die "plugin zip not found: ${PLUGIN_ZIP:-<none>} (pass --plugin <zip>)"
  mkdir -p "$DEST"
  local tmp; tmp="$(mktemp -d)"
  unzip -q "$PLUGIN_ZIP" -d "$tmp"
  rm -rf "$PLUGIN_DIR"; mv "$tmp/ds-foundry" "$PLUGIN_DIR"; rm -rf "$tmp"
  ok "plugin unpacked → $PLUGIN_DIR ($(basename "$PLUGIN_ZIP"))"
}

write_env() {
  cd "$SERVER_DIR"
  [[ -f .env ]] || cp .env.example .env
  set_kv() { # set_kv KEY VALUE — replace or append in .env
    if grep -q "^$1=" .env; then
      sed -i '' -e "s|^$1=.*|$1=$2|" .env 2>/dev/null || sed -i -e "s|^$1=.*|$1=$2|" .env
    else echo "$1=$2" >> .env; fi
  }
  # prompt only when interactive and nothing was supplied and nothing is set yet
  if [[ -z "$ANTHROPIC" && -t 0 ]] && ! grep -q '^ANTHROPIC_API_KEY=.\+' .env; then
    read -r -s -p "  Anthropic API key (Enter to skip): " ANTHROPIC; echo
  fi
  if [[ -z "$GEMINI" && -t 0 ]] && ! grep -q '^GOOGLE_API_KEY=.\+' .env; then
    read -r -s -p "  Gemini API key (Enter to skip): " GEMINI; echo
  fi
  [[ -n "$ANTHROPIC" ]] && set_kv ANTHROPIC_API_KEY "$ANTHROPIC"
  [[ -n "$GEMINI" ]] && set_kv GOOGLE_API_KEY "$GEMINI"
  chmod 600 .env
  local have_a have_g
  grep -q '^ANTHROPIC_API_KEY=.\+' .env && have_a=yes || have_a=no
  grep -q '^GOOGLE_API_KEY=.\+' .env && have_g=yes || have_g=no
  ok ".env ready (Anthropic key: $have_a · Gemini key: $have_g). Keys can also be pasted in the plugin per run."
}

install_deps() {
  cd "$SERVER_DIR"
  py_ok || die "Python 3.11+ is required. On macOS: brew install python@3.12"
  [[ -d .venv ]] || python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
  ok "python deps installed in $SERVER_DIR/.venv"
  if [[ $WANT_OLLAMA -eq 1 ]]; then
    ./.venv/bin/pip install -q langchain-ollama && ok "langchain-ollama installed"
    if have ollama; then ollama pull llama3.2-vision && ok "ollama model llama3.2-vision ready"
    else warn "ollama not installed — get it from https://ollama.com, then: ollama pull llama3.2-vision"; fi
  fi
}

run_tests() {
  cd "$SERVER_DIR"
  ./.venv/bin/python -m pytest -q tests && ok "pipeline tests pass"
}

start_bg() {
  cd "$SERVER_DIR"
  if server_running; then ok "server already running on :$PORT"; return; fi
  set -a; [[ -f .env ]] && source .env; set +a
  nohup ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >>"$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  wait_healthy && ok "server up: http://127.0.0.1:$PORT  (log: $LOG)" || die "server did not become healthy — see $LOG"
}

stop_bg() {
  if [[ -f "$PIDFILE" ]]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi
  # anything else bound to the port from an earlier run
  if have lsof; then lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; fi
  ok "server stopped"
}

install_launchd() {
  have launchctl || die "--launchd is macOS only"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd "$SERVER_DIR" &amp;&amp; set -a &amp;&amp; [ -f .env ] &amp;&amp; . ./.env; set +a; exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  stop_bg >/dev/null
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  wait_healthy && ok "server registered with launchd ($LABEL) and running on :$PORT — starts at login" || die "launchd job failed — see $LOG"
}

status() {
  say "DS Foundry status"
  [[ -d "$PLUGIN_DIR" ]] && ok "plugin: $PLUGIN_DIR (v$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PLUGIN_DIR/package.json"))" || warn "plugin not installed"
  [[ -d "$SERVER_DIR" ]] && ok "server: $SERVER_DIR" || warn "server not installed"
  if h="$(health)"; then ok "server healthy on :$PORT → $h"; else warn "server not responding on :$PORT"; fi
  [[ -f "$PLIST" ]] && ok "launchd: $PLIST" || true
}

figma_handoff() {
  say "Plugin → Figma (the one step that can't be scripted)"
  if have pbcopy; then printf '%s' "$PLUGIN_DIR/manifest.json" | pbcopy; ok "manifest path copied to clipboard"; fi
  echo "  1. In Figma: Plugins → Development → Import plugin from manifest…"
  echo "  2. In the file dialog press ⌘⇧G, paste (⌘V), press Enter, then Open."
  echo "     $PLUGIN_DIR/manifest.json"
  echo "  3. Plugins → Development → DS Foundry → Scan → AI naming → Provider: Proxy → Suggest names."
  echo "  (Already imported from this path before? Skip 1–2 — Figma picks up the new build automatically.)"
  if [[ $OPEN_FIGMA -eq 1 ]] && have open && [[ -d "/Applications/Figma.app" ]]; then open -a Figma && ok "Figma opened"; fi
}

# ---------------------------------------------------------------- commands

case "$CMD" in
  install|update)
    say "DS Foundry installer"
    [[ -n "$PLUGIN_ZIP" ]] || PLUGIN_ZIP="$(newest_zip ds-foundry)"
    [[ -n "$SERVER_ZIP" ]] || SERVER_ZIP="$(newest_zip ds-foundry-server)"
    have unzip || die "unzip not found"
    have curl || die "curl not found"
    say "Server"
    unpack_server
    write_env
    install_deps
    [[ $RUN_TESTS -eq 1 ]] && run_tests
    if [[ $START -eq 1 ]]; then
      if [[ $USE_LAUNCHD -eq 1 ]]; then install_launchd; else start_bg; fi
      ok "health: $(health)"
    fi
    say "Plugin"
    unpack_plugin
    figma_handoff
    ;;
  start)   if [[ -f "$PLIST" ]]; then launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true; wait_healthy && ok "running on :$PORT"; else start_bg; fi;;
  stop)    if [[ -f "$PLIST" ]]; then launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; fi; stop_bg;;
  restart) "$0" stop --port "$PORT" --dest "$DEST"; "$0" start --port "$PORT" --dest "$DEST";;
  status)  status;;
  logs)    tail -n 80 -f "$LOG";;
  test)    run_tests;;
  uninstall-launchd) launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; ok "launchd job removed";;
  *) die "unknown command: $CMD (install|start|stop|restart|status|logs|test|uninstall-launchd)";;
esac

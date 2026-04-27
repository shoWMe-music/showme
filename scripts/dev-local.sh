#!/usr/bin/env bash
# Full-stack local dev: Cloud Functions (watch) + Firebase emulators + Vite.
# Requires: npm install at repo root (and in ./functions).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local ]] && [[ ! -f .env ]]; then
  echo "Note: no .env — Vite uses implicit emulator demo config in dev (see src/integrations/firebase/config.ts)." >&2
fi

exec npm run dev:local

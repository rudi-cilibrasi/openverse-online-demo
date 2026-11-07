#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
for cmd in git python3 lake emcc em++; do
  if ! command -v "$cmd" >/dev/null; then
    echo "Missing $cmd. Run ./scripts/install-deps.sh first." >&2
    exit 1
  fi
done
python3 scripts/fetch-sources.py
cp wasm/Compiler.lean .build/openverse/Compiler.lean
(
  cd .build/openverse
  lake build OpenVerse.Front.Elab OpenVerse.Core.Encode
  lake env lean -c ../Compiler.c Compiler.lean
)
python3 scripts/build-wasm.py
cp web/* dist/
python3 - <<'PY'
import json
from pathlib import Path
Path('dist/build-info.json').write_text(json.dumps(json.loads(Path('sources.json').read_text()), indent=2) + '\n')
PY
echo 'Ready: python3 scripts/serve.py (http://localhost:8000)'

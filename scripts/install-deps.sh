#!/usr/bin/env bash
# The demo owns package installation; OpenVerse itself only checks for emcc.
set -euo pipefail
if ! command -v apt-get >/dev/null; then
  echo 'This installer requires Ubuntu/Debian (apt-get).' >&2
  exit 1
fi
as_root=()
if (( EUID != 0 )); then as_root=(sudo); fi
"${as_root[@]}" apt-get update
"${as_root[@]}" apt-get install -y build-essential git cmake python3 emscripten libuv1-dev curl ca-certificates
if ! command -v elan >/dev/null; then
  echo 'Installing elan, the Lean toolchain manager.'
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL https://elan.lean-lang.org/elan-init.sh -o "$installer"
  sh "$installer" -y --default-toolchain none
fi
echo 'Dependencies installed. Ensure ~/.elan/bin is in PATH, then run ./scripts/build.sh.'

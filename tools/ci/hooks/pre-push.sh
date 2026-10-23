#!/bin/sh
# Git hook shim. Installed by tools/ci/install-hooks.ps1.
root="$(git rev-parse --show-toplevel)" || exit 0
script="$root/tools/ci/hooks.ps1"
[ -f "$script" ] || exit 0
refs="$(mktemp)"; cat > "$refs"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$script")" -Hook pre-push -RefsFile "$(cygpath -w "$refs")"
code=$?; rm -f "$refs"; exit $code

#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

# Hyperframes uses bun + oxlint/oxfmt. Do not introduce pnpm/npm workspace commands.
commands=(
  "bun run build"
  "bun run lint"
  "bun run test"
)

failures=0
for c in "${commands[@]}"; do
  echo "▶ $c"
  if ! bash -lc "$c"; then
    failures=$((failures+1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "Hyperframes pre-commit gates failed ($failures). Fix before committing."
  exit 2
fi
exit 0

#!/usr/bin/env bash
# edit-accuracy-shard.sh <i/n>: runs one edit accuracy shard into /tmp/edit-accuracy, then re-runs twice each case
# whose verdict differs from the base branch (/tmp/base-edit-accuracy.json). A slow runner makes the bench exit 75.
set -euo pipefail
export HF_WRITE_TRACE="/tmp/edit-accuracy/write-trace-${1//\//-}.log"
mkdir -p /tmp/edit-accuracy
bench() { bun run --cwd packages/studio test:edit-accuracy -- --grid "$EDIT_ACCURACY_GRID" --jobs 2 "$@"; }
bench --shard "$1" --out /tmp/edit-accuracy/run1
mapfile -t FLIPPED < <(node packages/studio/tests/e2e/edit-accuracy/ratchet.mjs flipped \
  /tmp/base-edit-accuracy.json /tmp/edit-accuracy/run1/results.json)
if (( ${#FLIPPED[@]} > 0 )); then
  FILTER="^($(IFS='|'; echo "${FLIPPED[*]}"))$"
  for run in 2 3; do bench --filter "$FILTER" --rerun --out "/tmp/edit-accuracy/run${run}"; done
fi

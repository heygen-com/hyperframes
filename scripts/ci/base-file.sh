#!/usr/bin/env bash
# base-file.sh <path> <out>: writes <path> as it was on the base this pull_request run measured, the first parent of
# the checked-out merge commit. The base branch tip moves while a run is in flight, so it is never read. A base without
# the file removes <out>; a failed fetch fails the step.
set -euo pipefail
base="$(git cat-file -p HEAD | awk '/^parent /{print $2; exit}')"
echo "Reading $1 from the base this run measured: $base"
git fetch --no-tags --depth=1 origin "$base"
if git cat-file -e "$base:$1" 2>/dev/null; then
  git show "$base:$1" > "$2"
else
  rm -f "$2"
  echo "The base has no $1 yet"
fi

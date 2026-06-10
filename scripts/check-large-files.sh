#!/bin/sh
# Reject large binaries committed straight into the git pack instead of LFS.
#
# Why this exists: the repo's history carries hundreds of MB of binaries that
# should have been LFS — a 31 MB ONNX model, nested HDR-regression MP4s that
# dodged non-recursive .gitattributes globs, demo clips, scratch renders. Each
# was "noticed later and deleted," but a raw commit lives in history forever and
# every clone pays for it. This hook stops the next one at commit time.
#
# Rule: any staged file larger than $MAX_KB that is NOT routed through Git LFS
# fails the commit. Fix by either adding an LFS pattern in .gitattributes for
# that path/extension, or not committing the file (assets/, gitignore, etc.).
#
# Usage: check-large-files.sh <file> [<file> ...]   (lefthook passes staged files)

set -eu

MAX_KB="${HF_MAX_NONLFS_KB:-500}"
violations=0

for f in "$@"; do
  [ -f "$f" ] || continue

  # registry/ intentionally ships raw binary assets (block backgrounds, avatar
  # PNGs, .glb models, audio) so installed blocks stay portable without an LFS
  # round-trip. Those are the product, not accidental bloat — skip them here.
  # (Their size is managed by review + the recompression convention instead.)
  case "$f" in registry/*) continue ;; esac

  # Size in KB (portable: wc -c works everywhere; avoids stat's BSD/GNU split).
  bytes=$(wc -c < "$f" | tr -d ' ')
  kb=$((bytes / 1024))
  [ "$kb" -le "$MAX_KB" ] && continue

  # Is this path routed through LFS? `git check-attr` reads .gitattributes.
  filter=$(git check-attr filter -- "$f" | sed 's/.*: //')
  if [ "$filter" = "lfs" ]; then
    continue
  fi

  if [ "$violations" -eq 0 ]; then
    echo "ERROR: large binaries are being committed to git instead of LFS." >&2
    echo "       (limit: ${MAX_KB} KB — override per-commit with HF_MAX_NONLFS_KB)" >&2
    echo >&2
  fi
  echo "  • ${f} (${kb} KB)" >&2
  violations=$((violations + 1))
done

if [ "$violations" -gt 0 ]; then
  echo >&2
  echo "Fix: add an LFS pattern for it in .gitattributes, e.g." >&2
  echo "       path/to/**/*.ext filter=lfs diff=lfs merge=lfs -text" >&2
  echo "     then re-stage the file. Or, if it should not be committed at all," >&2
  echo "     add it to .gitignore." >&2
  exit 1
fi

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
# Usage:
#   check-large-files.sh                 # default: check the staged file set
#   check-large-files.sh <file> [<file>] # explicit files (handy for testing)
#
# We read the staged set ourselves rather than taking lefthook's {staged_files}
# expansion: that expands to a bare space-separated string, which splits paths
# containing spaces into separate args. `git diff --cached` + a line-based read
# keeps whole paths intact (only a literal newline in a filename would break it,
# which git quotes/escapes anyway).

set -u

MAX_KB="${HF_MAX_NONLFS_KB:-500}"

# Emit the list of paths to check, one per line.
list_files() {
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@"
  else
    # Added/Copied/Modified/Renamed staged paths (skip Deleted — nothing to size).
    git diff --cached --name-only --diff-filter=ACMR
  fi
}

violations="$(mktemp)"
trap 'rm -f "$violations"' EXIT INT TERM

list_files "$@" | while IFS= read -r f; do
  [ -n "$f" ] || continue

  # Skip symlinks: `wc -c` would measure the link *target's* bytes, so a symlink
  # to a large LFS-tracked asset could be flagged even though the real blob is a
  # tiny pointer. Symlinks themselves are never the bloat we're hunting.
  [ -L "$f" ] && continue
  [ -f "$f" ] || continue

  # registry/ intentionally ships raw binary assets (block backgrounds, avatar
  # PNGs, .glb models, audio) so installed blocks stay portable without an LFS
  # round-trip. Those are the product, not accidental bloat — skip them here.
  case "$f" in registry/*) continue ;; esac

  bytes="$(wc -c < "$f" | tr -d ' ')"
  # Ceiling division: a sub-1024-byte file must report >=1 KB, never 0, so it
  # can't slip past a strict threshold (e.g. HF_MAX_NONLFS_KB=0). Plain
  # `bytes / 1024` would round a 512-byte binary down to 0 and pass it.
  kb=$(( (bytes + 1023) / 1024 ))
  [ "$kb" -le "$MAX_KB" ] && continue

  # Is this path routed through LFS? `git check-attr` reads .gitattributes.
  filter="$(git check-attr filter -- "$f" | sed 's/.*: //')"
  [ "$filter" = "lfs" ] && continue

  printf '%s\t%s\n' "$kb" "$f" >> "$violations"
done

# `while` ran in a pipeline subshell, so it couldn't set a parent-shell flag —
# the violations file is the durable signal.
if [ -s "$violations" ]; then
  echo "ERROR: large binaries are being committed to git instead of LFS." >&2
  echo "       (limit: ${MAX_KB} KB — override per-commit with HF_MAX_NONLFS_KB)" >&2
  echo >&2
  while IFS='	' read -r kb f; do
    echo "  • ${f} (${kb} KB)" >&2
  done < "$violations"
  echo >&2
  echo "Fix: add an LFS pattern for it in .gitattributes, e.g." >&2
  echo "       path/to/**/*.ext filter=lfs diff=lfs merge=lfs -text" >&2
  echo "     then re-stage the file. Or, if it should not be committed at all," >&2
  echo "     add it to .gitignore." >&2
  exit 1
fi

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
#   check-large-files.sh --range <base> <head>  # files a commit range adds or changes (CI)
#
# The staged and range modes size the blob git stores, not the file on disk, so
# a file matching an LFS pattern but added without git-lfs installed is caught.
#
# We read the staged set ourselves rather than taking lefthook's {staged_files}
# expansion: that expands to a bare space-separated string, which splits paths
# containing spaces into separate args. `git diff --cached` + a line-based read
# keeps whole paths intact (only a literal newline in a filename would break it,
# which git quotes/escapes anyway).

set -u

MAX_KB="${HF_MAX_NONLFS_KB:-500}"

# Blob prefix for `git cat-file`: ":" is the index, "<head>:" a commit, empty
# means read the file on disk.
BLOB_REV=""
RANGE_BASE=""
RANGE_HEAD=""
if [ "${1:-}" = "--range" ]; then
  [ "$#" -eq 3 ] || { echo "usage: $0 --range <base> <head>" >&2; exit 2; }
  RANGE_BASE="$2"
  RANGE_HEAD="$3"
  BLOB_REV="$3:"
  shift 3
elif [ "$#" -eq 0 ]; then
  BLOB_REV=":"
fi

# Emit the paths to check, NUL-separated and unquoted (git quotes non-ASCII,
# quotes and tabs otherwise). Added/Copied/Modified/Renamed/Type-changed only.
list_files() {
  if [ -n "$RANGE_BASE" ]; then
    git diff -z --name-only --diff-filter=ACMRT "$RANGE_BASE" "$RANGE_HEAD"
  elif [ -n "$BLOB_REV" ]; then
    git diff -z --cached --name-only --diff-filter=ACMRT
  else
    printf '%s\0' "$@"
  fi
}

read_bytes() {
  if [ -n "$BLOB_REV" ]; then git cat-file blob "$BLOB_REV$1"; else cat -- "$1"; fi
}

violations="$(mktemp)"
errors="$(mktemp)"
paths="$(mktemp)"
blob="$(mktemp)"
trap 'rm -f "$violations" "$errors" "$paths" "$blob"' EXIT INT TERM

# A git error (bad ref, not a repo) must fail the check, not pass an empty list.
list_files "$@" > "$paths" || { echo "ERROR: could not list the files to check." >&2; exit 2; }
# Paths are NUL-separated, so a newline byte can only come from a filename; sh cannot
# keep such a name whole, so refuse it rather than check the wrong files.
if [ "$(tr -cd '\n' < "$paths" | wc -c)" -gt 0 ]; then
  echo "ERROR: a file name contains a newline; rename it." >&2
  exit 2
fi

tr '\0' '\n' < "$paths" | while IFS= read -r f; do
  [ -n "$f" ] || continue

  if [ -n "$BLOB_REV" ]; then
    # A submodule is not a blob; a symlink's blob is its short target path.
    kind="$(git cat-file -t "$BLOB_REV$f")" || { printf '%s\n' "$f" >> "$errors"; continue; }
    [ "$kind" = "blob" ] || continue
  else
    # Skip symlinks: `wc -c` would measure the link *target's* bytes, so a symlink
    # to a large LFS-tracked asset could be flagged even though the real blob is a
    # tiny pointer.
    [ -L "$f" ] && continue
    [ -f "$f" ] || continue
  fi

  # registry/ intentionally ships raw binary assets (block backgrounds, avatar
  # PNGs, .glb models, audio) so installed blocks stay portable without an LFS
  # round-trip. Those are the product, not accidental bloat — skip them here.
  # docs/public/catalog/ mirrors those same assets for the docs site.
  case "$f" in registry/* | docs/public/catalog/*) continue ;; esac

  # Text is exempt, whatever its size, because the cost this hook exists to stop
  # is a binary one. Git delta-compresses text, so a file that grows by a few KB
  # per commit adds a few KB to the pack. A binary of the same size re-enters the
  # pack whole on every edit, which is exactly how the history got its hundreds
  # of megabytes. `docs/changelog.mdx` is the case that forced this: half a
  # megabyte of release notes, a little larger every release, tripping a check
  # whose own error message says "large binaries".
  #
  # `grep -I` treats a file containing NUL bytes as binary, the same heuristic
  # git uses to print "Binary files differ". A generated blob of text is still
  # caught by review, not here.
  # Read once into a file so a failed read is an error, never an empty pass.
  read_bytes "$f" > "$blob" || { printf '%s\n' "$f" >> "$errors"; continue; }
  grep -qI . "$blob" && continue

  bytes="$(wc -c < "$blob" | tr -d ' ')"
  # Ceiling division: a sub-1024-byte file must report >=1 KB, never 0, so it
  # can't slip past a strict threshold (e.g. HF_MAX_NONLFS_KB=0). Plain
  # `bytes / 1024` would round a 512-byte binary down to 0 and pass it.
  kb=$(( (bytes + 1023) / 1024 ))
  [ "$kb" -le "$MAX_KB" ] && continue

  # A stored blob over the limit is raw bytes even when .gitattributes routes
  # the path through LFS (git-lfs was not installed). A file on disk under an
  # LFS pattern is the smudged copy of a pointer, so it passes.
  filter="$(git check-attr filter -- "$f" | sed 's/.*: //')"
  note=""
  if [ "$filter" = "lfs" ]; then
    [ -z "$BLOB_REV" ] && continue
    note=" — matches an LFS pattern but was stored raw; run \`git lfs install\` and re-add it"
  fi

  printf '%s\t%s\n' "$kb" "$f$note" >> "$violations"
done

if [ -s "$errors" ]; then
  echo "ERROR: could not read these files from git:" >&2
  sed 's/^/  • /' "$errors" >&2
  exit 2
fi

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

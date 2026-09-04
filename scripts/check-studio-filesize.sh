#!/bin/sh
# Enforce the packages/studio 600 LOC file cap (a studio architecture standard
# from the App.tsx decomposition work; Player and other packages enforce size
# discipline via code review and convention instead).
#
# Usage:
#   check-studio-filesize.sh                 # default: check the staged file set
#   check-studio-filesize.sh <file> [<file>] # explicit files (handy for testing)
#
# We read the staged set ourselves rather than taking lefthook's {staged_files}
# expansion and its glob/exclude filtering. On Windows, lefthook builds the
# command line for `run: |` blocks by wrapping the whole script in one
# double-quoted argument; a literal `"` anywhere in the script (quoting `$f` or
# an echo message, as this one did) closes that argument early and corrupts the
# rest of the command, so `sh.exe -c "..."` fails with a bare
# "syntax error: unexpected end of file" no matter what's staged. Reading the
# files ourselves and quoting freely inside this script file sidesteps that
# entirely — the same reasoning check-large-files.sh already applies for the
# {staged_files} space-splitting problem.

set -u

MAX_LINES="${HF_STUDIO_MAX_LINES:-600}"

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

  case "$f" in
    packages/studio/*.ts | packages/studio/*.tsx) ;;
    *) continue ;;
  esac
  case "$f" in
    *.test.ts | *.test.tsx | *.generated.*) continue ;;
  esac
  [ -f "$f" ] || continue

  lines="$(wc -l < "$f" | tr -d ' ')"
  [ "$lines" -le "$MAX_LINES" ] && continue

  printf '%s\t%s\n' "$lines" "$f" >> "$violations"
done

if [ -s "$violations" ]; then
  echo "ERROR: packages/studio files must stay under ${MAX_LINES} lines." >&2
  echo "       (override per-commit with HF_STUDIO_MAX_LINES)" >&2
  echo >&2
  while IFS='	' read -r lines f; do
    echo "  • ${f} (${lines} lines)" >&2
  done < "$violations"
  exit 1
fi

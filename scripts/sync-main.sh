#!/usr/bin/env bash
#
# Sync caleb with origin/main while preserving local skills/.
#
# - Merges origin/main into the current (caleb) branch.
# - Keeps skills/ exactly as it is on caleb (main's changes to skills/ are dropped).
# - Refreshes skills_pre/ with origin/main's skills/ tree as a side-by-side reference.
# - Never pushes. Run `git push` manually if you want to publish the merge.
#
# Usage:  bash scripts/sync-main.sh
#

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH_REQUIRED="refactor/skills-audit"
REMOTE="origin"
REMOTE_BRANCH="main"
SKILLS_DIR="skills"
SNAPSHOT_DIR="skills_pre"

log() { printf '\033[1;36m[sync-main]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[sync-main]\033[0m %s\n' "$*" >&2; }

# 1. Pre-flight checks
current_branch="$(git branch --show-current)"
if [ "$current_branch" != "$BRANCH_REQUIRED" ]; then
  err "Current branch is '$current_branch', expected '$BRANCH_REQUIRED'. Run: git checkout $BRANCH_REQUIRED"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  err "Working tree is not clean. Commit or stash your changes first."
  git status --short
  exit 1
fi

if [ ! -d "$SKILLS_DIR" ]; then
  err "$SKILLS_DIR/ not found at repo root. Aborting."
  exit 1
fi

# 2. Fetch latest origin/main
log "Fetching $REMOTE/$REMOTE_BRANCH..."
git fetch "$REMOTE" "$REMOTE_BRANCH"

# 3. Is there anything new?
incoming="$(git log --oneline "$BRANCH_REQUIRED..$REMOTE/$REMOTE_BRANCH" || true)"
if [ -z "$incoming" ]; then
  log "$REMOTE/$REMOTE_BRANCH has no new commits. Nothing to merge."
  exit 0
fi

incoming_count="$(printf '%s\n' "$incoming" | wc -l | tr -d ' ')"
log "$incoming_count new commit(s) to merge:"
printf '%s\n' "$incoming" | sed 's/^/    /'

# 4. Warn if main touched skills/ since the merge base
skills_diff="$(git diff --name-only "$BRANCH_REQUIRED...$REMOTE/$REMOTE_BRANCH" -- "$SKILLS_DIR" || true)"
if [ -n "$skills_diff" ]; then
  log "Note: $REMOTE/$REMOTE_BRANCH has changes under $SKILLS_DIR/ that will NOT be merged (kept in $SNAPSHOT_DIR/ only):"
  printf '%s\n' "$skills_diff" | sed 's/^/    /'
fi

# 5. Refresh skills_pre/ snapshot
log "Refreshing $SNAPSHOT_DIR/ from $REMOTE/$REMOTE_BRANCH:$SKILLS_DIR/ ..."
rm -rf "$SNAPSHOT_DIR"
mkdir -p "$SNAPSHOT_DIR"
git archive "$REMOTE/$REMOTE_BRANCH" "$SKILLS_DIR" | tar -x -C "$SNAPSHOT_DIR" --strip-components=1

# 6. Merge, preserving skills/
log "Merging $REMOTE/$REMOTE_BRANCH into $BRANCH_REQUIRED (will not commit yet)..."
git merge "$REMOTE/$REMOTE_BRANCH" --no-commit --no-ff

log "Restoring $SKILLS_DIR/ to $BRANCH_REQUIRED's pre-merge state..."
git checkout HEAD -- "$SKILLS_DIR"
git add "$SKILLS_DIR"

# Drop any files main added under skills/ that are now sitting in the worktree
# as untracked (because we just reverted the index but not the worktree adds).
untracked_in_skills="$(git ls-files --others --exclude-standard "$SKILLS_DIR" || true)"
if [ -n "$untracked_in_skills" ]; then
  log "Removing $SKILLS_DIR/ files that came from $REMOTE/$REMOTE_BRANCH but are not in $BRANCH_REQUIRED:"
  printf '%s\n' "$untracked_in_skills" | sed 's/^/    /'
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    rm -f -- "$f"
  done <<< "$untracked_in_skills"
fi

# 7. Finalize merge commit
log "Committing merge..."
git commit --no-edit

# 8. Verify
log "Verifying..."
if [ -n "$(git diff --stat HEAD^1 HEAD -- "$SKILLS_DIR")" ]; then
  err "$SKILLS_DIR/ unexpectedly changed in this merge. Inspect with: git diff HEAD^1 HEAD -- $SKILLS_DIR"
  exit 1
fi

# 9. Summary of what main brought in
#
# HEAD is the merge commit:
#   HEAD^1 = pre-merge caleb tip
#   HEAD^2 = origin/main tip that was merged in
# We diff from the merge base to HEAD^2 to describe what main contributed,
# and exclude skills/ since this script intentionally drops main's skills changes.
log "Summary of changes brought in from $REMOTE/$REMOTE_BRANCH:"
merge_base="$(git merge-base HEAD^1 HEAD^2)"

echo
log "  Commits ($incoming_count), grouped by type:"
git log --pretty=format:'%h %s' "$merge_base..HEAD^2" \
  | awk '
      {
        subject = $0
        sub(/^[^ ]+ /, "", subject)
        type = "other"
        colon_pos = index(subject, ":")
        if (colon_pos > 1) {
          prefix = substr(subject, 1, colon_pos - 1)
          sub(/\(.*\)/, "", prefix)
          sub(/!$/, "", prefix)
          if (prefix ~ /^[a-zA-Z]+$/) {
            type = tolower(prefix)
          }
        }
        commits[type] = commits[type] "      " $0 "\n"
        counts[type] += 1
      }
      END {
        order = "feat fix perf refactor docs test build ci chore style revert other"
        n = split(order, types, " ")
        for (i = 1; i <= n; i++) {
          t = types[i]
          if (t in counts) {
            printf "    %s (%d):\n", t, counts[t]
            printf "%s", commits[t]
            delete counts[t]
          }
        }
        for (t in counts) {
          printf "    %s (%d):\n", t, counts[t]
          printf "%s", commits[t]
        }
      }
  '

echo
log "  Files changed by area (excluding $SKILLS_DIR/):"
area_lines="$(git diff --name-only "$merge_base" HEAD^2 -- . ":!$SKILLS_DIR" \
  | awk -F/ '{ if (NF >= 2) print $1"/"$2; else print $1 }' \
  | sort | uniq -c | sort -rn \
  | awk '{printf "    %5d  %s\n", $1, $2}')"
if [ -n "$area_lines" ]; then
  printf '%s\n' "$area_lines"
else
  printf '    (no files outside %s/ changed)\n' "$SKILLS_DIR"
fi

echo
log "  Diffstat (excluding $SKILLS_DIR/):"
shortstat="$(git diff --shortstat "$merge_base" HEAD^2 -- . ":!$SKILLS_DIR" | sed 's/^[[:space:]]*//')"
if [ -n "$shortstat" ]; then
  printf '    %s\n' "$shortstat"
else
  printf '    (no line changes outside %s/)\n' "$SKILLS_DIR"
fi

echo
log "Done."
log "  - $BRANCH_REQUIRED now contains $REMOTE/$REMOTE_BRANCH (merge commit: $(git rev-parse --short HEAD))"
log "  - $SKILLS_DIR/ unchanged"
log "  - $SNAPSHOT_DIR/ refreshed with $REMOTE/$REMOTE_BRANCH's $SKILLS_DIR/ tree"
log "  - Nothing pushed to $REMOTE."

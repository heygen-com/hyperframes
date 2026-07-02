#!/usr/bin/env bash
# test-skills-fresh.sh
#
# Generic sandbox for the `test/skills-fresh` branch — fully simulates a real
# user's `npx` install, with BOTH channels coming from the working tree:
#   • skills → installed from skills/ via `npx skills add <repo>` (exactly what
#             `npx skills add heygen-com/hyperframes` does for a real user)
#   • CLI    → wired via a `file:` dep so `npx hyperframes` resolves to the LOCAL
#             build, which carries this branch's packages/cli/src/capture changes.
# It adds NO CLAUDE.md / AGENTS.md — it mirrors the plain install, nothing more.
# You then launch your agent in the sandbox and type whatever request you want.
#
# Agents: works for Claude Code (default) and Codex. `--agent` is passed straight
# to `skills add`, so the skills land in that agent's project dir:
#   • claude-code → .claude/skills/   (launch: claude --dangerously-skip-permissions)
#   • codex       → .agents/skills/   (launch: codex --dangerously-bypass-approvals-and-sandbox)
#                   ← both launch fully auto (no approval prompts); codex stays
#                   project-local and does NOT touch your global ~/.codex/skills.
#
# Why a sandbox (and not `npx skills add heygen-com/hyperframes#test/skills-fresh`):
#   `skills add` only copies skills/. The capture tool you changed lives in
#   packages/cli (the @hyperframes/cli package), so an online skills-only install
#   would pull this branch's skills but the PUBLISHED CLI's old capture. This
#   script builds + file:-links the local CLI so capture comes from the branch too.
#
# Usage:
#   bash scripts/test-skills-fresh.sh                    # Claude Code (default)
#   bash scripts/test-skills-fresh.sh --agent codex      # Codex
#   bash scripts/test-skills-fresh.sh --rebuild          # force a CLI rebuild
#   bash scripts/test-skills-fresh.sh --no-build         # skip the build step
#   bash scripts/test-skills-fresh.sh -h                 # help
#
# What it does:
#   1. Verifies prerequisites (bun, npm, the chosen agent, optionally Chrome).
#   2. Builds the local CLI if dist/cli.js is missing OR any packages/cli source
#      is newer than the built bundle (so your capture edits are never tested stale).
#   3. Creates a fresh WORKSPACE ROOT under /tmp/skills-fresh-<timestamp>/ with a
#      package.json (`file:` CLI dep). It does NOT init a hyperframes project here
#      — the video workflows run `npx hyperframes init` inside their own subdirs.
#   4. Runs npm install so `npx hyperframes` resolves to the local CLI build.
#   5. Installs the full skills tree from the LOCAL repo via `npx skills add
#      --agent <agent>`, then prunes the internal _meta/ authoring skills so the
#      installed set matches what an end user gets.
#   6. Verifies the router + 10 workflows + 6 domain skills landed.
#   7. Prints the command to start the agent + example prompts to try.
#
# Iterate after editing:
#   • skills  → re-run this script (fresh dir), or in the existing test dir:
#                 rm -rf <skills-dir>/<name> && npx --yes skills add <repo> \
#                   --skill <name> --agent <agent> --yes
#   • capture / CLI → just re-run this script; step 2's staleness check rebuilds.

set -uo pipefail

# --------- defaults ---------
EXPECTED_BRANCH="test/skills-fresh"
AGENT="claude-code"

# --------- arg parse ---------
BUILD_MODE="auto"   # auto | force | skip
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --agent)    AGENT="${2:-}"; shift 2 ;;
    --rebuild)  BUILD_MODE="force"; shift ;;
    --no-build) BUILD_MODE="skip"; shift ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

if [[ -z "$AGENT" ]]; then
  echo "--agent needs a value (e.g. claude-code, codex)" >&2
  exit 1
fi

# Map the agent to its project skills dir + launch binary.
case "$AGENT" in
  claude-code) SKILLS_DIR=".claude/skills"; AGENT_BIN="claude"; LAUNCH="claude --dangerously-skip-permissions" ;;
  codex)       SKILLS_DIR=".agents/skills"; AGENT_BIN="codex";  LAUNCH="codex --dangerously-bypass-approvals-and-sandbox" ;;
  *)           SKILLS_DIR=".agents/skills"; AGENT_BIN="$AGENT"; LAUNCH="$AGENT" ;;
esac

# --------- self-locate the hyperframes repo ---------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HF_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
HF_CLI_PKG="$HF_REPO/packages/cli"
HF_CLI_BIN="$HF_CLI_PKG/dist/cli.js"

# --------- pretty output helpers ---------
say()  { printf "\033[1;36m→ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[0;33m! %s\033[0m\n" "$*"; }
fail() { printf "  \033[0;31m✗ %s\033[0m\n" "$*"; exit 1; }

# --------- step 1: prerequisites ---------
say "Checking prerequisites (agent: $AGENT)..."

command -v bun >/dev/null 2>&1 || fail "bun not installed. Install: curl -fsSL https://bun.sh/install | bash"
command -v npm >/dev/null 2>&1 || fail "npm not installed (need Node.js — install Node 22+)."

ok "bun: $(bun --version)"
ok "node: $(node --version)"
ok "npm: $(npm --version)"

if command -v "$AGENT_BIN" >/dev/null 2>&1; then
  ok "$AGENT_BIN on PATH"
else
  warn "$AGENT_BIN not on PATH — install the $AGENT CLI before running the test."
fi

CHROME_MAC="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_LINUX="/usr/bin/chromium"
if [[ -x "$CHROME_MAC" ]] || [[ -x "$CHROME_LINUX" ]]; then
  ok "Chrome / Chromium found (capture / web-extraction needs headless Chrome)"
else
  warn "No Chrome at $CHROME_MAC or $CHROME_LINUX — capture-based workflows will fail without it"
fi

CURRENT_BRANCH="$(cd "$HF_REPO" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  warn "Repo is on '$CURRENT_BRANCH', not '$EXPECTED_BRANCH' — you'll be testing whatever is checked out."
else
  ok "repo on branch: $CURRENT_BRANCH"
fi

# --------- step 2: build local CLI (staleness-aware) ---------
say "Checking local CLI build..."

needs_build() {
  [[ ! -f "$HF_CLI_BIN" ]] && return 0
  # any CLI source (incl. capture/) newer than the built bundle → rebuild,
  # so your working-tree edits are never silently tested against a stale dist.
  local newer
  newer="$(find "$HF_CLI_PKG/src" "$HF_CLI_PKG/scripts" -type f -newer "$HF_CLI_BIN" 2>/dev/null | head -1)"
  [[ -n "$newer" ]] && return 0
  return 1
}

DO_BUILD=0
case "$BUILD_MODE" in
  force) DO_BUILD=1; warn "--rebuild: forcing a fresh CLI build" ;;
  skip)  warn "--no-build: skipping build; using existing dist (may be stale!)" ;;
  auto)  if needs_build; then
           DO_BUILD=1
           [[ -f "$HF_CLI_BIN" ]] && warn "CLI source is newer than dist — rebuilding to pick up your capture/CLI edits" \
                                  || warn "CLI not built — building (~1-2 min)..."
         fi ;;
esac

if [[ "$DO_BUILD" == "1" ]]; then
  (cd "$HF_REPO" && bun install && bun run build) || fail "CLI build failed."
  [[ -f "$HF_CLI_BIN" ]] || fail "Build completed but $HF_CLI_BIN still missing."
fi
ok "local CLI: $(node "$HF_CLI_BIN" --version 2>/dev/null || echo unknown)"

# --------- step 3: scaffold a fresh test project ---------
TEST_PARENT="${TEST_PARENT:-/tmp}"
TEST_NAME="skills-fresh-$(date +%H%M%S)"
TEST_DIR="$TEST_PARENT/$TEST_NAME"

say "Creating test project at $TEST_DIR ..."

mkdir -p "$TEST_PARENT"
cd "$TEST_PARENT"
[[ -e "$TEST_NAME" ]] && fail "$TEST_DIR already exists. Wait 1s and re-run."

# WORKSPACE ROOT, not a hyperframes project: the video workflows run
# `npx hyperframes init` inside their own subdirs, so a project at the root would
# make a skill find a stray composition here. We only need a package.json with the
# `file:` CLI dep so `npx hyperframes` (and the skills' init/render calls from
# subdirs) resolve to the local build.
mkdir -p "$TEST_NAME"
cd "$TEST_NAME"

cat > package.json <<JSON
{
  "name": "$TEST_NAME",
  "private": true,
  "type": "module",
  "dependencies": {
    "hyperframes": "file:$HF_CLI_PKG"
  }
}
JSON

ok "package.json points hyperframes → file:$HF_CLI_PKG"

# --------- step 4: npm install (NOT bun) ---------
# MUST be npm: bun follows the cli pkg's `workspace:*` devDependencies and fails.
# npm only resolves the file: package's `dependencies`.
say "Running npm install (must be npm here, not bun)..."

npm install --no-audit --no-fund --silent || fail "npm install failed."
[[ -x "node_modules/.bin/hyperframes" ]] || fail "node_modules/.bin/hyperframes missing after install."
ok "node_modules/.bin/hyperframes → local CLI"

# --------- step 5: install skills from the local repo, then prune _meta ---------
say "Installing skills from the local repo (--agent $AGENT) ..."

npx --yes skills add "$HF_REPO" --skill '*' --agent "$AGENT" --yes \
  || fail "skills add failed."

# Resolve where they actually landed (claude-code → .claude/skills,
# codex/others → .agents/skills); fall back to whichever dir got populated.
if [[ ! -d "$SKILLS_DIR" ]]; then
  for d in .claude/skills .agents/skills .cursor/skills; do
    [[ -d "$d" ]] && SKILLS_DIR="$d" && break
  done
fi
[[ -d "$SKILLS_DIR" ]] || fail "No skills dir found after install (looked for .claude/skills, .agents/skills, .cursor/skills)."
ok "skills installed under $SKILLS_DIR/"

# skills add walks skills/_meta/ too — those are internal authoring skills, not
# part of the end-user set. Prune them so the sandbox matches a real install.
if [[ -d "$HF_REPO/skills/_meta" ]]; then
  for meta in "$HF_REPO/skills/_meta"/*/; do
    [[ -d "$meta" ]] || continue
    name="$(basename "$meta")"
    if [[ -d "$SKILLS_DIR/$name" ]]; then
      rm -rf "$SKILLS_DIR/$name"
      ok "pruned internal meta-skill: $name"
    fi
  done
fi

# --------- step 6: verify the skills landed ---------
say "Verifying skill installation..."

ROUTER="hyperframes"
WORKFLOWS=(product-launch-video website-to-video faceless-explainer embedded-captions \
           talking-head-recut pr-to-video motion-graphics general-video \
           remotion-to-hyperframes slideshow)
DOMAIN=(hyperframes-core hyperframes-creative hyperframes-animation hyperframes-cli hyperframes-media hyperframes-registry)

MISSING=()
check_skill() { if [[ -d "$SKILLS_DIR/$1" ]]; then ok "$SKILLS_DIR/$1/"; else MISSING+=("$1"); fi; }

check_skill "$ROUTER"
for s in "${WORKFLOWS[@]}"; do check_skill "$s"; done
for s in "${DOMAIN[@]}"; do check_skill "$s"; done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "Missing skill(s): ${MISSING[*]}"
  warn "Check skills/ in the repo and re-run — routing / dispatch will break without these."
fi

INSTALLED_COUNT=$(find "$SKILLS_DIR" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
ok "$INSTALLED_COUNT skill(s) installed under $SKILLS_DIR/"

# --------- step 7: print next steps ---------
echo ""
printf "\033[1;32m========================================================\033[0m\n"
printf "\033[1;32m Sandbox ready — branch skills + branch CLI (capture).\033[0m\n"
printf "\033[1;32m========================================================\033[0m\n"
echo ""
echo "Project:  $TEST_DIR"
echo "Agent:    $AGENT  (skills in $SKILLS_DIR/)"
echo "CLI:      file:$HF_CLI_PKG  (local build — includes your capture changes)"
echo "Branch:   $CURRENT_BRANCH"
echo ""
echo "To start, run:"
echo ""
printf "  \033[1;37mcd %s\033[0m\n" "$TEST_DIR"
printf "  \033[1;37m%s\033[0m\n" "$LAUNCH"
echo ""
echo "Then type any request you want to test — the agent routes it to a workflow. e.g.:"
echo "  • \"make a product launch video for https://your-site.com/\"      → product-launch-video (exercises capture)"
echo "  • \"explain how transformers work as a faceless explainer video\" → faceless-explainer"
echo "  • \"make a video from this PR: owner/repo#123\"                    → pr-to-video"
echo "  • \"add lower-thirds / overlay cards to ./clip.mp4\"               → talking-head-recut"
echo "  • \"add captions/subtitles to ./clip.mp4\"                         → embedded-captions"
echo "  • \"turn https://your-site.com/ into a site tour video\"           → website-to-video"
echo "  • \"a logo reveal / title card / data montage\"                    → general-video"
echo ""

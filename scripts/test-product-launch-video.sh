#!/usr/bin/env bash
# test-product-launch-video.sh
#
# One-shot test harness for the /product-launch-video Claude skill.
# Creates a self-contained project wired to the LOCAL hyperframes repo
# (CLI + skills), then tells you the two commands to launch Claude Code.
#
# Usage:
#   bash scripts/test-product-launch-video.sh                       # default URL
#   bash scripts/test-product-launch-video.sh https://example.com/  # custom URL
#   bash scripts/test-product-launch-video.sh -h                    # help
#
# What it does:
#   1. Verifies prerequisites (bun, npm, optionally Chrome + claude).
#   2. Builds the local CLI if dist/cli.js is missing.
#   3. Creates a fresh project under /tmp/launch-video-<timestamp>/, scaffolded
#      via the local CLI with --skip-skills.
#   4. Patches the project's package.json so npx hyperframes resolves to the
#      local CLI build (not the published npm version).
#   5. Installs the skills tree (web-extraction, story-design,
#      visual-design, product-launch-video, hyperframes-*) from the
#      LOCAL repo into the project's .claude/skills/ via `npx skills add`.
#   6. Verifies the 5 launch-video-related skills landed correctly.
#   7. Prints the two commands you need to start the test.
#
# Why each step matters (read once, then forget):
#   - Step 2 is needed because the setup uses `node $REPO/packages/cli/dist/cli.js init`
#     to scaffold — that file must exist.
#   - Step 4 uses `file:` deps so the project tracks live edits to the repo.
#     MUST be npm (not bun): bun follows the cli pkg's `workspace:*`
#     devDependencies and fails. npm only resolves the file: package's
#     `dependencies`.
#   - Step 5 passes `--agent claude-code` explicitly. `--all` defaults to
#     detected agents only and would skip Claude Code (only AGENTS.md is
#     written by init, which Codex/Cursor detect, but skills CLI doesn't
#     treat it as a Claude Code marker). Explicit --agent makes skills land
#     in .claude/skills/ which is what cc reads.
#
# Iterate after editing skills:
#   The skills are COPIED (not symlinked) into the test project. To pick up
#   edits in skills/, either re-run this script (creates a fresh dir) or run:
#     cd <test_dir> && rm -rf .claude/skills/product-launch-video && \
#       npx --yes skills add /Users/wenbozhu/Dev/work/hyperframes \
#         --skill product-launch-video --agent claude-code --yes

set -uo pipefail

# --------- defaults ---------
DEFAULT_URL="https://hyperframes.heygen.com/"

# --------- arg parse ---------
URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown flag: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
    *)
      URL="$1"
      shift
      ;;
  esac
done

[[ -z "$URL" ]] && URL="$DEFAULT_URL"

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
say "Checking prerequisites..."

command -v bun >/dev/null 2>&1 || fail "bun not installed. Install: curl -fsSL https://bun.sh/install | bash"
command -v npm >/dev/null 2>&1 || fail "npm not installed (need Node.js — install Node 22+)."

ok "bun: $(bun --version)"
ok "node: $(node --version)"
ok "npm: $(npm --version)"

if command -v claude >/dev/null 2>&1; then
  ok "claude (Claude Code) on PATH"
else
  warn "claude not on PATH — you'll need Claude Code installed (https://claude.ai/download)"
fi

CHROME_MAC="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_LINUX="/usr/bin/chromium"
if [[ -x "$CHROME_MAC" ]] || [[ -x "$CHROME_LINUX" ]]; then
  ok "Chrome / Chromium found (web-extraction phase needs headless Chrome)"
else
  warn "No Chrome at $CHROME_MAC or $CHROME_LINUX — Phase 1 (web-extraction) will fail without it"
fi

# Branch hint — orchestrator + sub-skills currently live on a feature branch
CURRENT_BRANCH="$(cd "$HF_REPO" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "$CURRENT_BRANCH" != "refactor/skills-audit" ]]; then
  warn "Current branch is '$CURRENT_BRANCH'. /product-launch-video lives on 'refactor/skills-audit' — if you don't see it, switch branches."
fi

# --------- step 2: build local CLI if missing ---------
say "Checking local CLI build..."

if [[ ! -f "$HF_CLI_BIN" ]]; then
  warn "CLI not built at $HF_CLI_BIN — running bun install + bun run build (~30-60s)..."
  (cd "$HF_REPO" && bun install && bun run build) || fail "CLI build failed."
  [[ -f "$HF_CLI_BIN" ]] || fail "Build completed but $HF_CLI_BIN still missing."
fi
ok "local CLI: $(node "$HF_CLI_BIN" --version 2>/dev/null || echo unknown)"

# --------- step 3: scaffold a fresh test project ---------
TEST_PARENT="${TEST_PARENT:-/tmp}"
TEST_NAME="launch-video-$(date +%H%M%S)"
TEST_DIR="$TEST_PARENT/$TEST_NAME"

say "Creating test project at $TEST_DIR ..."

mkdir -p "$TEST_PARENT"
cd "$TEST_PARENT"

if [[ -e "$TEST_NAME" ]]; then
  fail "$TEST_DIR already exists. Pick another timestamp by waiting 1s and re-running."
fi

node "$HF_CLI_BIN" init "$TEST_NAME" \
  --non-interactive --skip-skills --example=blank \
  || fail "hyperframes init failed."

cd "$TEST_NAME"

# --------- step 4: patch package.json (use file: dep, strip npx pins) ---------
say "Patching package.json to use the local CLI..."

HF_CLI_PKG_FOR_NODE="$HF_CLI_PKG" node - <<'JS'
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('package.json', 'utf8'));
j.dependencies = j.dependencies || {};
j.dependencies.hyperframes = 'file:' + process.env.HF_CLI_PKG_FOR_NODE;
for (const k of Object.keys(j.scripts || {})) {
  j.scripts[k] = j.scripts[k]
    .replace(/npx\s+(?:--yes\s+)?hyperframes(@[^\s]+)?/g, 'hyperframes');
}
fs.writeFileSync('package.json', JSON.stringify(j, null, 2) + '\n');
JS

ok "package.json points hyperframes → file:$HF_CLI_PKG"

# --------- step 5: npm install (NOT bun — see header notes) ---------
say "Running npm install (this is the one place we must use npm, not bun)..."

npm install --no-audit --no-fund --silent || fail "npm install failed."
[[ -x "node_modules/.bin/hyperframes" ]] || fail "node_modules/.bin/hyperframes missing after install."
ok "node_modules/.bin/hyperframes → local CLI"

# --------- step 6: install skills from the local repo ---------
say "Installing skills from the local repo into .claude/skills/ ..."

npx --yes skills add "$HF_REPO" --skill '*' --agent claude-code --yes \
  || fail "skills add failed."

# --------- step 7: verify the 5 launch-video-related skills landed ---------
say "Verifying skill installation..."

REQUIRED=(web-extraction story-design visual-design product-launch-video hyperframes-animation)
MISSING=()
for s in "${REQUIRED[@]}"; do
  if [[ -d ".claude/skills/$s" ]]; then
    ok ".claude/skills/$s/"
  else
    MISSING+=("$s")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "Missing skill(s): ${MISSING[*]}"
  warn "Subagent dispatches that rely on them will fail. Check skills/ in the repo and re-run."
fi

# Verify the orchestrator's agents/ wrappers came across
AGENTS_DIR=".claude/skills/product-launch-video/agents"
if [[ -d "$AGENTS_DIR" ]]; then
  AGENT_COUNT=$(find "$AGENTS_DIR" -maxdepth 1 -name "*.md" -type f | wc -l | tr -d ' ')
  ok "$AGENTS_DIR/ has $AGENT_COUNT subagent prompt file(s)"
else
  warn "$AGENTS_DIR/ missing — the orchestrator's dispatch wrappers didn't come across."
fi

# --------- step 8: print next steps ---------
echo ""
printf "\033[1;32m========================================================\033[0m\n"
printf "\033[1;32m Setup complete.\033[0m\n"
printf "\033[1;32m========================================================\033[0m\n"
echo ""
echo "Project:  $TEST_DIR"
echo "Target:   $URL"
echo ""
echo "To start the test, run these two commands:"
echo ""
printf "  \033[1;37mcd %s\033[0m\n" "$TEST_DIR"
printf "  \033[1;37mclaude --dangerously-skip-permissions\033[0m\n"
echo ""
echo "Then paste this prompt into Claude:"
echo ""
printf "  \033[1;33mmake a product launch video for %s\033[0m\n" "$URL"
echo ""
echo "What to watch for:"
echo "  • Claude should invoke the /product-launch-video skill (not /website-to-hyperframes)"
echo "  • It should dispatch 4 subagents via the Agent tool (not run phases inline)"
echo "  • Phase 1 produces  ./extraction/"
echo "  • Phase 2 produces  ./narrator_scripts.json"
echo "  • Phase 3 produces  ./section_plan.md"
echo "  • Phase 4 produces  ./hyperframes/  (HTML composition)"
echo "  • Each phase appends a line to ./context.log"
echo ""
echo "If the skill doesn't auto-trigger, force it with:"
printf "  \033[1;33muse the /product-launch-video skill to make a launch video for %s\033[0m\n" "$URL"
echo ""

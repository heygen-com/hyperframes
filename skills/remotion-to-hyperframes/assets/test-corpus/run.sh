#!/usr/bin/env bash
# run.sh — corpus orchestrator. Runs every tier and prints a pass/fail summary.
#
# Tiers 1-3: render Remotion baseline + HF translation, run SSIM diff,
#            assert mean >= ssim_threshold from each fixture's expected.json.
# Tier 4:    runs cases/validate.sh which lints each case and asserts against
#            expected.json.
#
# Usage:
#   ./run.sh                    run all tiers
#   ./run.sh tier-1-title-card  run a single tier
#
# Requirements:
#   - ffmpeg, ffprobe, python3 on PATH
#   - node 22 (for the HF CLI)
#   - npm (for Remotion installs)
#   - HF CLI built at packages/cli/dist/cli.js (run `bun run --filter @hyperframes/cli build`
#     in the repo root if missing)
#
# Output:
#   <fixture>/diff/summary.json   per-fixture SSIM summary
#   <fixture>/strip/strip.png     per-fixture comparison strip (only on fail)
#   ./run-report.json             aggregate report

set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$THIS_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"

LINT="$SKILL_DIR/scripts/lint_source.py"
DIFF="$SKILL_DIR/scripts/render_diff.sh"
STRIP="$SKILL_DIR/scripts/frame_strip.sh"
HF_CLI="$REPO_ROOT/packages/cli/dist/cli.js"
REPORT="$THIS_DIR/run-report.json"

# Per-fixture results land here as one JSON file each, then the aggregator
# globs them. This is safer than building JSON via bash string concatenation
# (a fixture name containing a quote would break the previous approach).
RESULTS_DIR="$(mktemp -d)"
trap 'rm -rf "$RESULTS_DIR"' EXIT

# T4 is lint-only — no ffmpeg or HF CLI needed. Defer the render-tier
# toolchain checks until run_render_tier() actually runs, so
# `./run.sh tier-4-escape-hatch` works on a clean checkout.
require_render_tier_tools() {
  if [[ ! -f "$HF_CLI" ]]; then
    echo "error: HF CLI not built at $HF_CLI" >&2
    echo "       Run 'bun run --filter @hyperframes/cli build' in $REPO_ROOT" >&2
    return 2
  fi
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "error: ffmpeg not on PATH" >&2
    return 2
  fi
  return 0
}

# Write one fixture's result as a JSON file. Values are passed via argv so
# bash string interpolation can't corrupt the JSON or inject Python source.
write_result() {
  local fixture_name="$1"
  local status="$2"
  shift 2
  python3 - "$RESULTS_DIR/$fixture_name.json" "$fixture_name" "$status" "$@" <<'PY'
import json
import sys

out_path, fixture_name, status, *kvs = sys.argv[1:]
result = {"fixture": fixture_name, "status": status}
for i in range(0, len(kvs), 2):
    k, v = kvs[i], kvs[i + 1]
    try:
        result[k] = float(v) if "." in v or v.lstrip("-").isdigit() else v
    except ValueError:
        result[k] = v
with open(out_path, "w") as f:
    json.dump(result, f)
PY
}

# Read a top-level scalar value from a JSON file. Falls back to $3 if the
# key is missing (used to default composition_id for older fixtures).
read_json_value() {
  local file="$1"
  local key="$2"
  local default="${3:-}"
  python3 - "$file" "$key" "$default" <<'PY'
import json
import sys

path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)
val = data.get(key, default)
print(val if val is not None else "")
PY
}

run_render_tier() {
  local fixture_dir="$1"
  local fixture_name
  fixture_name=$(basename "$fixture_dir")
  local expected="$fixture_dir/expected.json"

  if ! require_render_tier_tools; then
    echo "  ⚠ $fixture_name: render toolchain unavailable, skipping"
    write_result "$fixture_name" "skipped" reason "render toolchain unavailable"
    return 0
  fi

  local threshold composition_id
  threshold=$(read_json_value "$expected" "ssim_threshold")
  composition_id=$(read_json_value "$expected" "composition_id" "Composition")

  echo "  ▶ $fixture_name (threshold $threshold, composition $composition_id)"

  if [[ -x "$fixture_dir/setup.sh" ]]; then
    "$fixture_dir/setup.sh" >/dev/null
  fi

  if ! python3 "$LINT" "$fixture_dir/remotion-src/src/" >/dev/null; then
    echo "    ✗ lint failed (blockers in Remotion source)"
    write_result "$fixture_name" "fail" stage "lint"
    return 0
  fi

  if [[ ! -d "$fixture_dir/remotion-src/node_modules" ]]; then
    echo "    ⏳ npm install (first run)"
    (cd "$fixture_dir/remotion-src" && npm install --silent --no-progress >/dev/null 2>&1)
  fi

  echo "    ⏳ render Remotion baseline"
  if ! (cd "$fixture_dir/remotion-src" && \
        npx --no-install remotion render "$composition_id" out/baseline.mp4 >/dev/null 2>&1); then
    echo "    ✗ Remotion render failed"
    write_result "$fixture_name" "fail" stage "remotion-render"
    return 0
  fi

  echo "    ⏳ render HF translation"
  if ! (cd "$fixture_dir" && \
        node "$HF_CLI" render hf-src/ --output hf.mp4 --quiet >/dev/null 2>&1); then
    echo "    ✗ HF render failed"
    write_result "$fixture_name" "fail" stage "hf-render"
    return 0
  fi

  if R2HF_SSIM_THRESHOLD="$threshold" "$DIFF" \
      "$fixture_dir/remotion-src/out/baseline.mp4" \
      "$fixture_dir/hf.mp4" \
      "$fixture_dir/diff" >/dev/null; then
    local mean
    mean=$(read_json_value "$fixture_dir/diff/summary.json" "mean")
    echo "    ✓ pass (mean SSIM $mean, threshold $threshold)"
    write_result "$fixture_name" "pass" mean_ssim "$mean" threshold "$threshold"
  else
    local mean
    mean=$(read_json_value "$fixture_dir/diff/summary.json" "mean")
    echo "    ✗ fail (mean SSIM $mean, threshold $threshold)"
    "$STRIP" \
      "$fixture_dir/remotion-src/out/baseline.mp4" \
      "$fixture_dir/hf.mp4" \
      "$fixture_dir/strip" 8 >/dev/null
    write_result "$fixture_name" "fail" stage "ssim" mean_ssim "$mean" threshold "$threshold"
  fi
}

run_lint_tier() {
  local fixture_dir="$1"
  local fixture_name
  fixture_name=$(basename "$fixture_dir")

  echo "  ▶ $fixture_name (lint-only)"
  if "$fixture_dir/validate.sh" >/dev/null 2>&1; then
    echo "    ✓ pass (8/8 cases)"
    write_result "$fixture_name" "pass" mode "lint"
  else
    echo "    ✗ fail (some cases mismatched expected.json)"
    write_result "$fixture_name" "fail" mode "lint"
  fi
}

echo "remotion-to-hyperframes corpus run"
echo "=================================="

for tier in tier-1-title-card tier-2-multi-scene tier-3-data-driven; do
  if [[ -n "${1:-}" && "$1" != "$tier" ]]; then
    continue
  fi
  if [[ -d "$THIS_DIR/$tier" ]]; then
    run_render_tier "$THIS_DIR/$tier"
  fi
done

if [[ -z "${1:-}" || "$1" == "tier-4-escape-hatch" ]]; then
  if [[ -d "$THIS_DIR/tier-4-escape-hatch" ]]; then
    run_lint_tier "$THIS_DIR/tier-4-escape-hatch"
  fi
fi

# Aggregate the per-fixture JSON files into one report.
#
# Skipped fixtures are *not* a pass — they mean a tier didn't run because
# tooling or fixtures were unavailable. The orchestrator exits non-zero on
# any skip so a clean checkout that lacks the HF CLI doesn't accidentally
# report "passed 1/4" (T4 alone) and look like the corpus is healthy.
#
# Single-tier mode (`./run.sh tier-N`) only writes a result file for the
# selected tier; tiers that weren't run aren't counted as skips.
python3 - "$RESULTS_DIR" "$REPORT" <<'PY'
import json
import sys
from pathlib import Path

results_dir, out_path = Path(sys.argv[1]), Path(sys.argv[2])
results = sorted(
    (json.loads(p.read_text()) for p in results_dir.glob("*.json")),
    key=lambda r: r["fixture"],
)

total = len(results)
passed = sum(1 for r in results if r["status"] == "pass")
failed = sum(1 for r in results if r["status"] == "fail")
skipped = sum(1 for r in results if r["status"] == "skipped")
report = {
    "total": total,
    "passed": passed,
    "failed": failed,
    "skipped": skipped,
    "results": results,
}
out_path.write_text(json.dumps(report, indent=2))

print()
print("=" * 50)
print(f"  passed {passed}/{total}, failed {failed}, skipped {skipped}")
print(f"  report → {out_path}")
if skipped > 0:
    skipped_fixtures = [r["fixture"] for r in results if r["status"] == "skipped"]
    skipped_reasons = sorted({r.get("reason", "unknown") for r in results if r["status"] == "skipped"})
    print()
    print(f"  ⚠ {skipped} skipped: {', '.join(skipped_fixtures)}")
    for reason in skipped_reasons:
        print(f"    reason: {reason}")
    print("  Skipped fixtures count as failures for the aggregate.")
print("=" * 50)
sys.exit(0 if failed == 0 and skipped == 0 else 1)
PY

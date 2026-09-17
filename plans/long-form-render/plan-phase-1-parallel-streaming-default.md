# Phase 1: Multi-worker streaming by default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-worker mp4/mov render streams captured frames through the existing interleaved writer into one ffmpeg process by default, instead of writing raw RGBA frames to disk, so scratch space is bounded by the encoded output.

**Architecture:** The non-drawElement parallel-stream router already exists in `packages/producer/src/services/renderOrchestrator.ts` behind the env kill switch `HF_CAPTURE_PARALLEL_STREAM` (default off). It sets `captureParallelStreamForced`, which `explainStreamingEncodeGate` (Phase 0) turns into `parallel_forced`. The ordering bug that could defeat the router on macOS hardware-GPU hosts was fixed in commit `26513984f` (2026-09-11, PR #3886); nothing to do there. This phase flips the router's default to on via a pure, tested helper, keeps `=false` as the kill switch, and leaves the drawElement parallel router (`HF_DE_PARALLEL_STREAM`) untouched because it has its own self-verification contract.

**Tech Stack:** TypeScript, vitest, PostHog HogQL (sizing query, optional).

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §5 "Phase 1", §2.4 item 7, §2.5, §6.

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, no new dependencies.
- Tests: `cd packages/producer && bunx vitest run <file>`; whole unit lane: `node scripts/run-test-lane.mjs unit vitest`.
- **Depends on Phase 0.** The router's `streamingOk` input is `shouldUseStreamingEncode(cfg, outputFormat, 1, job.duration)`; with the cap still on, a 300 s render is ineligible regardless of this phase. Confirm `explainStreamingEncodeGate` exists in `renderOrchestrator.ts` before starting.

---

## File map

| File                                                                | Change                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/producer/src/services/renderOrchestrator.ts`              | Add exported `isCaptureParallelStreamRouterEnabled(env)`; use it at line ~3488 instead of `process.env.HF_CAPTURE_PARALLEL_STREAM === "true"`; update the two log strings that say "Set HF_CAPTURE_PARALLEL_STREAM=false to disable" (already correct) and the `eligible_off` comment. |
| `packages/producer/src/services/renderOrchestrator.test.ts`         | New `describe("isCaptureParallelStreamRouterEnabled")`; update the router test `"is disabled by default (kill switch off is the shipped default)"` (line ~2946) whose name is now wrong.                                                                                               |
| `packages/producer/src/services/render/stages/captureStage.ts`      | Preflight message: multi-worker is no longer a disk-path reason for mp4/mov.                                                                                                                                                                                                           |
| `packages/producer/src/services/render/stages/captureStage.test.ts` | Update the Phase 0 message test.                                                                                                                                                                                                                                                       |
| `docs/`                                                             | Any mention of `HF_CAPTURE_PARALLEL_STREAM` (grep).                                                                                                                                                                                                                                    |

---

### Task 0 (no code): size the cohort

The `eligible_off` signal on `render_complete.capture_parallel_stream` counts renders that pass every router gate except the kill switch. Run this in PostHog project "Hyperframes" (id 356858) before flipping, and paste the result into the PR description:

```sql
SELECT
  properties.capture_parallel_stream AS outcome,
  count() AS renders,
  uniq(distinct_id) AS hosts
FROM events
WHERE event = 'render_complete'
  AND timestamp >= now() - INTERVAL 14 DAY
  AND properties.os IS NOT NULL
  AND properties.capture_parallel_stream IS NOT NULL
GROUP BY outcome
ORDER BY renders DESC
```

Expected shape: `eligible_off` is the large bucket; `screenshot` / `beginframe` are the opted-in few. If the tool is unavailable, note that in the PR and continue; the flip is still correct by the spec.

---

### Task 1: Pure router-enabled helper, default on

**Files:**

- Modify: `packages/producer/src/services/renderOrchestrator.ts` (add helper near `shouldStreamParallelCapture`, line ~2107; use at line ~3488)
- Test: `packages/producer/src/services/renderOrchestrator.test.ts`

**Interfaces:**

- Produces:

```ts
/** HF_CAPTURE_PARALLEL_STREAM: unset or any value other than "false" → on. */
export function isCaptureParallelStreamRouterEnabled(env: NodeJS.ProcessEnv): boolean;
```

- [ ] **Step 1: Write the failing tests**

In `renderOrchestrator.test.ts`, directly before `describe("shouldStreamParallelCapture (non-DE parallel streaming router)", ...)` (line ~2933) add:

```ts
describe("isCaptureParallelStreamRouterEnabled", () => {
  it("is on by default (unset env)", () => {
    expect(isCaptureParallelStreamRouterEnabled({})).toBe(true);
  });

  it("stays on for the legacy explicit opt-in", () => {
    expect(isCaptureParallelStreamRouterEnabled({ HF_CAPTURE_PARALLEL_STREAM: "true" })).toBe(true);
  });

  it("is off only for the literal string false", () => {
    expect(isCaptureParallelStreamRouterEnabled({ HF_CAPTURE_PARALLEL_STREAM: "false" })).toBe(
      false,
    );
    expect(isCaptureParallelStreamRouterEnabled({ HF_CAPTURE_PARALLEL_STREAM: "FALSE" })).toBe(
      false,
    );
    expect(isCaptureParallelStreamRouterEnabled({ HF_CAPTURE_PARALLEL_STREAM: "0" })).toBe(true);
    expect(isCaptureParallelStreamRouterEnabled({ HF_CAPTURE_PARALLEL_STREAM: "" })).toBe(true);
  });
});
```

Rename the existing router test at line ~2946 from `"is disabled by default (kill switch off is the shipped default)"` to `"honours the kill switch when the caller passes routerEnabled=false"`; its body stays.

Add `isCaptureParallelStreamRouterEnabled` to the import from `"./renderOrchestrator.js"` at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/renderOrchestrator.test.ts -t "isCaptureParallelStreamRouterEnabled"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the helper**

In `renderOrchestrator.ts`, directly above `export function shouldStreamParallelCapture(args: {` (line ~2107) add:

```ts
/**
 * Non-DE parallel-stream router kill switch. Default ON since Phase 1 of the
 * long-form render plan: multi-worker mp4/mov renders stream through the
 * interleaved writer instead of writing raw RGBA frames to disk (spec §2.5:
 * the disk preflight was failing ~2k renders/day). Only the literal string
 * "false" (any case) disables it; a legacy "true" opt-in is a no-op.
 */
export function isCaptureParallelStreamRouterEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.HF_CAPTURE_PARALLEL_STREAM;
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== "false";
}
```

- [ ] **Step 4: Use it at the call site**

Find line ~3488:

```ts
const captureParallelStreamRouterEnabled = process.env.HF_CAPTURE_PARALLEL_STREAM === "true";
```

Replace with:

```ts
const captureParallelStreamRouterEnabled = isCaptureParallelStreamRouterEnabled(process.env);
```

Then update the comment on the `else if` branch (line ~3521–3527) that says "emit a passive cohort-sizing signal … for the default-off soak" to:

```ts
// Kill switch explicitly off: keep emitting `eligible_off` so a fleet
// that disabled the default can still be sized from telemetry.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/renderOrchestrator.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Change the helper's `if (raw === undefined) return true;` to `return false;`, run the `isCaptureParallelStreamRouterEnabled` tests, expect the default test to FAIL, restore, rerun, expect PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
bunx oxlint packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
/usr/bin/git add packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): stream multi-worker screenshot renders by default

Flip the non-DE parallel-stream router (HF_CAPTURE_PARALLEL_STREAM) to
default-on through a pure, tested helper. Multi-worker mp4/mov renders now
route through the interleaved writer into one ffmpeg process instead of the
raw-RGBA disk path. "false" remains the kill switch; the drawElement router
(HF_DE_PARALLEL_STREAM) is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Preflight message after the flip

**Files:**

- Modify: `packages/producer/src/services/render/stages/captureStage.ts` (`assertDiskCaptureHeadroom`)
- Test: `packages/producer/src/services/render/stages/captureStage.test.ts`

- [ ] **Step 1: Update the test written in Phase 0**

In the test `"tells the user which routes still use disk capture, not a dead env var"`, replace

```ts
expect(message).toContain("--workers 1");
```

with

```ts
expect(message).toContain("HF_CAPTURE_PARALLEL_STREAM=false");
expect(message).toContain("png-sequence");
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureStage.test.ts`
Expected: FAIL on `HF_CAPTURE_PARALLEL_STREAM=false`.

- [ ] **Step 3: Change the message**

Replace the message body in `assertDiskCaptureHeadroom` with:

```ts
throw new Error(
  `Disk capture may need ~${(headroom.estimatedBytes / 1e6).toFixed(1)} MB of temporary frame storage, ` +
    `but only ${(headroom.freeBytes / 1e6).toFixed(1)} MB is free at ${framesDir}. ` +
    "Disk capture stores every frame as raw RGBA. mp4/mov renders stream by default; this render " +
    "landed on disk because the output is png-sequence, gif, HDR or shader-transition, or because " +
    "HF_CAPTURE_PARALLEL_STREAM=false or PRODUCER_ENABLE_STREAMING_ENCODE=false is set. " +
    "Re-run with --low-memory-mode, remove the override, or free up disk space.",
);
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureStage.test.ts`
Expected: PASS.

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/stages/captureStage.ts packages/producer/src/services/render/stages/captureStage.test.ts
/usr/bin/git add packages/producer/src/services/render/stages/captureStage.ts packages/producer/src/services/render/stages/captureStage.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(producer): describe the remaining disk-capture routes in the preflight error

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Docs and the Phase 1 manual gate

- [ ] **Step 1: Docs**

Run: `cd ~/src/wt/hyperframes/nle-render-spec && grep -rn "HF_CAPTURE_PARALLEL_STREAM\|parallel.*stream" docs | grep -v node_modules`. For each hit, say the router is on by default and `HF_CAPTURE_PARALLEL_STREAM=false` disables it. If no hits, add one row to the env-var table in the CLI reference page (find it with `grep -rn "PRODUCER_ENABLE_STREAMING_ENCODE" docs`), same format as the neighbouring rows.

- [ ] **Step 2: Build and run the gate**

Fixtures: see `packages/producer/tests/long-form/README.md` (Phase 0 Task 4). Then:

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
cd /tmp/hf-longform && rm -rf a-single/renders
node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 4 --quality draft -o a-single/renders/phase1.mp4 2>&1 | tee /tmp/hf-longform/phase1.log | grep -aoE 'streaming-encode gate \{[^}]*\}|Parallel [a-z]+ capture will stream[^"]{0,60}|rendered in [^"]{0,20}|Render failed|Disk capture may need'
ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/phase1.mp4
du -sh a-single/renders
```

Expected: a gate line with `"enabled":true,"reason":"parallel_forced","workerCount":4`; the "will stream to the encoder (interleaved, 4 workers)" log; duration `300.000000`; renders dir under 2 GB (the encoded output only). Before this phase the same command failed at preflight asking for ~75 GB.

- [ ] **Step 3: Kill-switch check**

Run the same render with `HF_CAPTURE_PARALLEL_STREAM=false` prefixed. Expected: it fails at preflight with the new message from Task 2 (on a machine with < 75 GB free) or, on a machine with room, logs `reason":"multi_worker"`. Either proves the switch works. Do not leave the render running; Ctrl-C after the gate line if it proceeds.

- [ ] **Step 4: Commit docs (if changed)**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
/usr/bin/git add docs
/usr/bin/git commit -F - <<'EOF'
docs: parallel streaming capture is on by default; document the kill switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review against the spec

- §5 Phase 1 item 1 (ordering gap): already shipped in `26513984f`; recorded in the spec, no task.
- §5 Phase 1 item 2 ("true when the parallel-stream router is eligible"): satisfied by the default flip. The router sets `captureParallelStreamForced`, which the Phase 0 gate turns into `parallel_forced`; `shouldUseStreamingEncode` itself does not need a second edit.
- §5 Phase 1 item 3 (kill switches, cohort sizing): Task 0, Task 1.
- §5 Phase 1 item 4 (disk fallback for excluded formats): unchanged behaviour; Task 2 documents it in the message.
- §6 telemetry: `capture_parallel_stream` values shift from mostly `eligible_off` to `screenshot` / `beginframe`; the dashboard tile that counted `eligible_off` becomes the kill-switch cohort. Note this in the PR.
- §8 "a-single -w 4 stock config renders to 300.000 s with peak scratch < 2 GB": Task 3 step 2.

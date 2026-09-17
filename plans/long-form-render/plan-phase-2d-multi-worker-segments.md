# Phase 2d: Multi-worker segments and default-on for long renders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `--workers N`, segmented capture runs N browser sessions in parallel, each pulling whole segments from a shared queue and encoding them into its own ffmpeg; the router then makes segmented capture the default for long mp4/mov renders (duration ≥ `HF_SEGMENTED_MIN_SECONDS`, default 600) while `HF_SEGMENTED_CAPTURE=false` stays as the kill switch.

**Architecture:** The 2a–2c stage already captures one segment at a time with a session held in a `SessionFactory`. 2d generalises: a `SegmentQueue` hands out `SegmentSlice`s in index order; `W` worker loops each own a session (recycled per 2c) and run `captureSegment` on the slices they receive; retries stay per segment inside the worker. Segments complete out of order but are concatenated in index order at the end, so ordering never touches the encoders. Browser pooling is disabled for worker sessions (`enableBrowserPool: false`), matching the DE parallel path's finding that co-tenant pages share one compositor. Progress aggregates frames across workers. The router change is a pure predicate `shouldSegmentCapture({ env, workerCount, durationSeconds, outputFormat, layered })` replacing 2a's single-worker gate.

**Tech Stack:** TypeScript, vitest.

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §5 "Phase 2" items 1–2 (worker queue), "Router precedence", §8 soak gate.

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, no new dependencies.
- Tests: producer `cd packages/producer && bunx vitest run <file>`.
- **Depends on Phases 2a, 2b, 2c and Phase 1.** Never run more than 3 concurrent Chrome fleets on a dev Mac (vault: kernel-panic history); gates below use `-w 3`.
- drawElement stays off in segmented workers (no runtime self-verification in this path); `captureCfg` for workers sets `useDrawElement: false` explicitly.

---

## File map

| File                                                                         | Change                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| `packages/producer/src/services/render/segmentQueue.ts` (new)                | `createSegmentQueue(slices)` → `next(): SegmentSlice                                               | undefined`, `remaining()`. |
| `packages/producer/src/services/render/segmentQueue.test.ts` (new)           | Order + exhaustion.                                                                                |
| `packages/producer/src/services/render/stages/captureSegmentedStage.ts`      | `workerCount` input; worker loops; per-worker factory; aggregated progress; concat in index order. |
| `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts` | 3 workers × 7 segments; failure in one worker aborts the others.                                   |
| `packages/producer/src/services/render/capturePlan.ts`                       | `sdr_segmented` allowed for `workerCount > 1`.                                                     |
| `packages/producer/src/services/renderOrchestrator.ts`                       | `shouldSegmentCapture` predicate; default-on; pass `workerCount`.                                  |
| `packages/producer/src/services/renderOrchestrator.test.ts`                  | Predicate matrix.                                                                                  |
| `packages/producer/tests/long-form/README.md`                                | 2d and soak gates.                                                                                 |
| `docs/`                                                                      | env rows updated: `HF_SEGMENTED_CAPTURE` default, `HF_SEGMENTED_MIN_SECONDS`.                      |

## Names

```ts
export interface SegmentQueue {
  next(): SegmentSlice | undefined;
  remaining(): number;
}
export function createSegmentQueue(slices: readonly SegmentSlice[]): SegmentQueue;
export const DEFAULT_SEGMENTED_MIN_SECONDS = 600;
export function shouldSegmentCapture(args: {
  env: NodeJS.ProcessEnv;
  workerCount: number;
  durationSeconds: number;
  outputFormat: string;
  layeredOrEffectRoute: boolean;
  streamingOk: boolean; // explainStreamingEncodeGate(cfg, format, 1, duration).enabled
}): boolean;
// CaptureSegmentedStageInput gains: workerCount: number; sessionFactoryForWorker?: (workerId: number) => SessionFactory;
// success result: workerCount: number (was the literal 1)
```

---

### Task 1: `createSegmentQueue`

**Files:**

- Create: `packages/producer/src/services/render/segmentQueue.ts`
- Test: `packages/producer/src/services/render/segmentQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createSegmentQueue } from "./segmentQueue.js";
import { planSegments } from "./segmentPlan.js";

describe("createSegmentQueue", () => {
  it("hands out slices in index order and then undefined forever", () => {
    const q = createSegmentQueue(planSegments(7, 3));
    expect(q.remaining()).toBe(3);
    expect(q.next()?.index).toBe(0);
    expect(q.next()?.index).toBe(1);
    expect(q.next()?.index).toBe(2);
    expect(q.next()).toBeUndefined();
    expect(q.next()).toBeUndefined();
    expect(q.remaining()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: Implement**

```ts
import type { SegmentSlice } from "./segmentPlan.js";

export interface SegmentQueue {
  next(): SegmentSlice | undefined;
  remaining(): number;
}

/** Single-threaded JS: no locking needed; `next()` is atomic per call. */
export function createSegmentQueue(slices: readonly SegmentSlice[]): SegmentQueue {
  let cursor = 0;
  return {
    next: () => (cursor < slices.length ? slices[cursor++] : undefined),
    remaining: () => slices.length - cursor,
  };
}
```

- [ ] **Step 4: Run, commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec && (cd packages/producer && bunx vitest run src/services/render/segmentQueue.test.ts)
bunx oxfmt packages/producer/src/services/render/segmentQueue.ts packages/producer/src/services/render/segmentQueue.test.ts
/usr/bin/git add packages/producer/src/services/render/segmentQueue.ts packages/producer/src/services/render/segmentQueue.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): in-order segment queue for parallel segmented capture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Worker loops in the stage

**Files:**

- Modify: `packages/producer/src/services/render/stages/captureSegmentedStage.ts`
- Test: `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("runCaptureSegmentedStage with workers", () => {
  it("distributes 7 segments over 3 workers, each frame captured once, concat in index order", async () => {
    const perWorkerSessions = new Map<number, number>();
    const sessionFactoryForWorker = (workerId: number) => ({
      create: async () => {
        perWorkerSessions.set(workerId, (perWorkerSessions.get(workerId) ?? 0) + 1);
        return fakeSession();
      },
    });
    const captured: number[] = [];
    const captureFrame = vi.fn(async (_s: unknown, i: number) => {
      captured.push(i);
      await new Promise((r) => setTimeout(r, 1)); // let workers interleave
      return { buffer: Buffer.alloc(1) };
    });
    const concat = vi.fn(async () => ({ success: true as const }));
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 20, probeSession: null }),
      segmentFrames: 3, // 7 segments
      workerCount: 3,
      sessionFactoryForWorker,
      deps: { spawnEncoder: okEncoder(), captureFrame, concat },
    });
    expect(result.success && result.workerCount).toBe(3);
    expect([...captured].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(perWorkerSessions.size).toBe(3);
    const concatInputs = concat.mock.calls[0]?.[0] as string[];
    expect(concatInputs.map((p) => p.slice(-9))).toEqual([
      "00000.mp4",
      "00001.mp4",
      "00002.mp4",
      "00003.mp4",
      "00004.mp4",
      "00005.mp4",
      "00006.mp4",
    ]);
  });

  it("a hard failure in one worker rejects the stage and closes every session", async () => {
    const closed: number[] = [];
    let id = 0;
    const sessionFactoryForWorker = () => ({
      create: async () => ({ ...fakeSession(), id: id++ }),
    });
    const captureFrame = vi.fn(async (_s: unknown, i: number) => {
      if (i === 4) throw new Error("media_start_out_of_range");
      return { buffer: Buffer.alloc(1) };
    });
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 9, probeSession: null }),
        segmentFrames: 3,
        workerCount: 3,
        sessionFactoryForWorker,
        deps: {
          spawnEncoder: okEncoder(),
          captureFrame,
          concat: okConcat(),
          closeSession: async (s) => {
            closed.push(s.id);
          },
        },
      }),
    ).rejects.toThrow(/media_start_out_of_range/);
    expect(closed.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts -t "with workers"`
Expected: FAIL — unknown inputs.

- [ ] **Step 3: Implement**

Restructure the 2c body into a `runWorker(workerId)` closure:

```ts
  const workerCount = Math.max(1, input.workerCount ?? 1);
  const queue = createSegmentQueue(segments.filter((s) => !skip.has(s.index)));
  const results = new Map<number, string>(); // index → path (includes skipped)
  for (const s of segments) if (skip.has(s.index)) results.set(s.index, segmentOutputPath(segmentDir, s.index));
  let totalCapturedFrames = 0;
  let failure: Error | null = null;
  const workerAbort = new AbortController();
  const forwardAbort = () => workerAbort.abort();
  abortSignal?.addEventListener("abort", forwardAbort);

  const runWorker = async (workerId: number): Promise<void> => {
    const factory = input.sessionFactoryForWorker?.(workerId) ?? (workerId === 0 ? defaultFactory : freshFactory());
    let session = await factory.create();
    let sessionSegments = 0;
    try {
      for (;;) {
        if (failure || workerAbort.signal.aborted) return;
        const segment = queue.next();
        if (!segment) return;
        if (recycleEvery > 0 && sessionSegments >= recycleEvery) { /* recycleSession per 2c, scoped to this worker's `session` */ }
        input.updateCaptureObservability?.({ segmentIndex: segment.index });
        const outputPath = segmentOutputPath(segmentDir, segment.index);
        try {
          encodeMs += await captureSegment(session, segment, outputPath, (framesDone) => { totalCapturedFrames += framesDone; /* progress update using totalCapturedFrames/totalFrames */ });
        } catch (err) {
          if (!isTargetLossError(err) || workerAbort.signal.aborted) throw err;
          segmentRetries += 1;
          input.updateCaptureObservability?.({ segmentRetries });
          // recycle this worker's session (2c) then:
          encodeMs += await captureSegment(session, segment, outputPath, /* progress */);
        }
        sessionSegments += 1;
        results.set(segment.index, outputPath);
        input.onSegmentComplete?.({ ... }); // 2b
      }
    } catch (err) {
      failure ??= err instanceof Error ? err : new Error(String(err));
      workerAbort.abort();
      throw err;
    } finally {
      lastBrowserConsole = session.browserConsoleBuffer;
      dedupPerfs.push(getCapturePerfSummary(session));
      await deps.closeSession(session).catch(() => {});
    }
  };

  const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, (_, w) => runWorker(w)));
  abortSignal?.removeEventListener("abort", forwardAbort);
  const rejected = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
  if (rejected) throw wrapCaptureStageError(rejected.reason, lastBrowserConsole);

  const segmentPaths = segments.map((s) => {
    const p = results.get(s.index);
    if (!p) throw new Error(`[Render] segment ${s.index} missing after capture`);
    return p;
  });
```

`captureSegment` takes the session as a parameter now (it was a closure over the single `session` in 2c) and calls the progress callback with the frame count it captured (for progress, report `totalCapturedFrames` every 30 frames across workers). `freshFactory()` returns a factory that calls `createCaptureSession(fileServer.url, framesDir, buildCaptureOptions(), createRenderVideoFrameInjector(), { ...captureCfg, enableBrowserPool: false, useDrawElement: false })` then `initializeSession` + `completeDeferredDrawElementInit`; worker 0 keeps the default factory so a `probeSession` is reused. Worker sessions must each get their own injector instance (`createRenderVideoFrameInjector()` per session), as the streaming stage's parallel path does.

Result: `workerCount` becomes the real number. Keep the 2a single-worker behaviour identical when `workerCount === 1` (all existing tests must still pass).

- [ ] **Step 4: Run all stage tests, typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts && bunx tsc --noEmit -p .`
Expected: PASS for 2a, 2b, 2c and 2d tests.

- [ ] **Step 5: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
bunx oxlint packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git add packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): parallel workers for segmented capture via an in-order segment queue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Router predicate and default-on

**Files:**

- Modify: `packages/producer/src/services/renderOrchestrator.ts`
- Modify: `packages/producer/src/services/render/capturePlan.ts` (drop the `workerCount === 1` condition for `sdr_segmented`; keep `forceParallelStream: false`)
- Test: `packages/producer/src/services/renderOrchestrator.test.ts`, `capturePlan.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("shouldSegmentCapture", () => {
  const base = {
    env: {},
    workerCount: 1,
    durationSeconds: 900,
    outputFormat: "mp4",
    layeredOrEffectRoute: false,
    streamingOk: true,
  };
  it("is on by default for long mp4/mov renders", () => {
    expect(shouldSegmentCapture(base)).toBe(true);
    expect(shouldSegmentCapture({ ...base, outputFormat: "mov" })).toBe(true);
    expect(shouldSegmentCapture({ ...base, workerCount: 4 })).toBe(true);
  });
  it("is off below HF_SEGMENTED_MIN_SECONDS unless forced", () => {
    expect(shouldSegmentCapture({ ...base, durationSeconds: 120 })).toBe(false);
    expect(
      shouldSegmentCapture({
        ...base,
        durationSeconds: 120,
        env: { HF_SEGMENTED_CAPTURE: "true" },
      }),
    ).toBe(true);
    expect(
      shouldSegmentCapture({
        ...base,
        durationSeconds: 120,
        env: { HF_SEGMENTED_MIN_SECONDS: "60" },
      }),
    ).toBe(true);
  });
  it("honours the kill switch and the exclusions", () => {
    expect(shouldSegmentCapture({ ...base, env: { HF_SEGMENTED_CAPTURE: "false" } })).toBe(false);
    expect(shouldSegmentCapture({ ...base, outputFormat: "webm" })).toBe(false);
    expect(shouldSegmentCapture({ ...base, outputFormat: "png-sequence" })).toBe(false);
    expect(shouldSegmentCapture({ ...base, layeredOrEffectRoute: true })).toBe(false);
    expect(shouldSegmentCapture({ ...base, streamingOk: false })).toBe(false);
  });
});
```

And in `capturePlan.test.ts` change the 2a assertion that segmented requires `workerCount === 1` into one that accepts `workerCount: 3` → `kind: "sdr_segmented"`.

- [ ] **Step 2: Run to verify they fail**, then **Step 3: Implement**

```ts
export const DEFAULT_SEGMENTED_MIN_SECONDS = 600;

function resolveSegmentedMinSeconds(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.HF_SEGMENTED_MIN_SECONDS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SEGMENTED_MIN_SECONDS;
}

/**
 * Segmented capture routing (spec §5 "Router precedence"). Default on for
 * long H.264/H.265/ProRes renders; HF_SEGMENTED_CAPTURE=true forces it for any
 * length, =false disables it. webm stays out (VP9 concat-copy is fragile).
 */
export function shouldSegmentCapture(args: {
  env: NodeJS.ProcessEnv;
  workerCount: number;
  durationSeconds: number;
  outputFormat: string;
  layeredOrEffectRoute: boolean;
  streamingOk: boolean;
}): boolean {
  const flag = args.env.HF_SEGMENTED_CAPTURE?.trim().toLowerCase();
  if (flag === "false") return false;
  if (!args.streamingOk || args.layeredOrEffectRoute) return false;
  if (args.outputFormat !== "mp4" && args.outputFormat !== "mov") return false;
  if (flag === "true") return true;
  return args.durationSeconds >= resolveSegmentedMinSeconds(args.env);
}
```

Replace `isSegmentedCaptureRequested` usages in the plan-creation input with:

```ts
      useSegmentedCapture: shouldSegmentCapture({
        env: process.env,
        workerCount,
        durationSeconds: job.duration,
        outputFormat,
        layeredOrEffectRoute: hasHdrContent || compiled.hasShaderTransitions,
        streamingOk: explainStreamingEncodeGate(cfg, outputFormat, 1, job.duration).enabled,
      }),
```

Delete `isSegmentedCaptureRequested` and its test. In `capturePlan.ts` remove `&& input.workerCount === 1` from the segmented branch. In the segmented stage invocation pass `workerCount`. Router precedence: the segmented check must run **before** the parallel-stream router so a long multi-worker render takes segments, not the interleaved single encoder; when segmented wins, set `captureParallelStreamForced = false` and skip the router (`if (useSegmentedCapture) { … } else { existing router block }`). The gate log line's `reason` stays whatever `explainStreamingEncodeGate` says; add `segmented: useSegmentedCapture` to the logged object.

- [ ] **Step 4: Typecheck, lane, gates**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx tsc --noEmit -p . && node scripts/run-test-lane.mjs unit vitest`

Manual gates (fixtures per `packages/producer/tests/long-form/README.md`; the 300 s fixture is below the 600 s default, so force with the flag):

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
cd /tmp/hf-longform && rm -rf a-single/renders c-clips60/renders
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 3 --quality draft -o a-single/renders/phase2d.mp4 2>&1 | grep -aE 'segment complete|rendered in|Render failed'
ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/phase2d.mp4
ffmpeg -i a-single/renders/phase2a.mp4 -i a-single/renders/phase2d.mp4 -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*'
# clip boundaries: many short clips from one source
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render c-clips60 --fps 30 -w 3 --quality draft -o c-clips60/renders/phase2d.mp4
node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render c-clips60 --fps 30 -w 1 --quality draft -o c-clips60/renders/reference.mp4
ffmpeg -i c-clips60/renders/reference.mp4 -i c-clips60/renders/phase2d.mp4 -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*'
```

Expected: six `segment complete` lines (order may interleave), duration `300.000000`, PSNR ≥ 45 dB for both comparisons (spec §8 "PSNR against the -w 1 output ≥ 45 dB at every 5 s clip boundary").

Default-on check: generate a 700 s fixture (`ffmpeg … -t 700 …; DUR=700 node gen.mjs`) and render `a-single -w 3` with **no** env vars. Expected: segmented path engages (`segment complete` lines) and the gate log shows `segmented:true`.

- [ ] **Step 5: Soak gate (nightly, not per-PR)**

Add to `packages/producer/tests/long-form/README.md` a "Soak" section: 40-minute source (`-t 2400`, `DUR=2400`), `render a-single --fps 30 -w 3 --debug`, record completion, `segment_retries`, `browserRecycles` from the log, peak `chrome_renderer_rss_peak_mb` from `perf-summary.json`, wall time. Acceptance: five consecutive nights with zero unrecovered failures. Wire it as a scheduled job only if the repo already has a nightly workflow (`ls .github/workflows | grep -i nightly`); otherwise document it as a manual weekly run and open an issue to automate.

- [ ] **Step 6: Docs and commit**

Update the env-var rows: `HF_SEGMENTED_CAPTURE` (default on for renders ≥ 600 s; `false` disables; `true` forces), `HF_SEGMENTED_MIN_SECONDS`, `HF_SEGMENT_FRAMES`, `HF_SEGMENT_BROWSER_RECYCLE`, and the `--resume` / `--keep-segments` flags on the render command page.

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts packages/producer/src/services/render/capturePlan.ts packages/producer/src/services/render/capturePlan.test.ts
bunx oxlint packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
/usr/bin/git add packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts packages/producer/src/services/render/capturePlan.ts packages/producer/src/services/render/capturePlan.test.ts packages/producer/tests/long-form/README.md docs
/usr/bin/git commit -F - <<'EOF'
feat(producer): segmented capture by default for long mp4/mov renders, any worker count

Long renders (>= HF_SEGMENTED_MIN_SECONDS, default 600 s) route to
segmented capture ahead of the interleaved parallel-stream router.
HF_SEGMENTED_CAPTURE=false disables; =true forces for any length.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review against the spec

- §5 Phase 2 item 2 "Workers take segments from a queue … a worker keeps its browser session across segments": Tasks 1–2.
- Item 1 chunk sizing: `planSegments` fixed size is kept; `resolveChunkPlan` is not used (spec updated in 2a).
- "Router precedence after all phases": Task 3 puts segmented ahead of the parallel router for long renders; `HF_SEGMENTED_CAPTURE` semantics match §6 (`=false` kill switch).
- §8 soak gate at 72k frames: Task 3 step 5.
- §8 "c-clips60 -w 4 renders; PSNR against -w 1 ≥ 45 dB": Task 3 step 4 (with `-w 3` per the dev-Mac fleet limit; use `-w 4` on a Linux CI host).
- Contention ceiling from the vault (one GPU serialises compositors): segmented workers are screenshot-only (`useDrawElement: false`) so the DE contention finding does not apply; wall-clock gains on footage comps are expected to be modest (spec §2.4 item 7), bounded scratch and blast radius are the point.

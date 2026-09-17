# Phase 2c: Browser recycling and one retry per segment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In segmented capture, the browser session is replaced every `HF_SEGMENT_BROWSER_RECYCLE` segments (default 3 → about 9,000 captured frames per session at the default segment size), and a segment whose capture dies with a Chrome target loss is retried once on a fresh session before the render fails. Retries and recycles are counted on observability.

**Architecture:** `runCaptureSegmentedStage` gets a `SessionFactory` (create + initialize + attach injector) instead of a single session. A `sessionSegmentsCaptured` counter triggers `closeCaptureSession` + factory call between segments. Frame capture inside a segment is wrapped: on an error matching the target-loss class (`Target closed`, `detached Frame`, `Session closed`, `Protocol error` with `Target` in the text), the partial segment file is deleted, the session is recycled, and the segment restarts from `startFrame` once. A second failure on the same segment rethrows. Each recycle/retry logs the last Chrome memory sample (Phase −1) so the field data in spec §2.5 gains a per-event memory reading.

**Tech Stack:** TypeScript, vitest with fake session factory.

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §5 "Phase 2" items 2 (recycle) and 3 (retry), §2.5, §6.

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, no new dependencies.
- Tests: producer `cd packages/producer && bunx vitest run <file>`.
- **Depends on Phase 2a** (and 2b for manifest interplay; a retried segment must not be recorded as complete until its second attempt closes) and **Phase −1** (`ChromeMemoryStats` on the session, `segmentRetries` observability field).
- A retry must never write the same frame twice into an encoder: the partial segment's encoder is closed and its file deleted before the retry spawns a new one.

---

## File map

| File                                                                         | Change                                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/producer/src/services/render/segmentRecycle.ts` (new)              | `isTargetLossError`, `resolveSegmentBrowserRecycle`.                                                     |
| `packages/producer/src/services/render/segmentRecycle.test.ts` (new)         | Classifier + env.                                                                                        |
| `packages/producer/src/services/render/stages/captureSegmentedStage.ts`      | `SessionFactory`, recycle counter, per-segment retry, observability `segmentRetries`.                    |
| `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts` | Recycle cadence; retry once; second failure rethrows.                                                    |
| `packages/producer/src/services/renderOrchestrator.ts`                       | Build the factory from `createCaptureSession` + `initializeSession` + `completeDeferredDrawElementInit`. |

## Names

```ts
export interface SessionFactory {
  /** Fresh, initialized session with the video injector attached. */
  create(): Promise<CaptureSession>;
}
export const DEFAULT_SEGMENT_BROWSER_RECYCLE = 3;
export function resolveSegmentBrowserRecycle(env: NodeJS.ProcessEnv): number; // HF_SEGMENT_BROWSER_RECYCLE; 0 = never recycle; default 3
export function isTargetLossError(error: unknown): boolean;
// CaptureSegmentedStageInput gains:
//   sessionFactory?: SessionFactory;   // default: built from probeSession/createCaptureSession as in 2a
//   browserRecycleEverySegments?: number;
//   updateCaptureObservability?: (patch: { capturePath?: "segmented"; segmentIndex?: number; segmentRetries?: number }) => void;
// CaptureSegmentedStageResult (success) gains: segmentRetries: number; browserRecycles: number;
```

---

### Task 1: Classifier and env

**Files:**

- Create: `packages/producer/src/services/render/segmentRecycle.ts`
- Test: `packages/producer/src/services/render/segmentRecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_BROWSER_RECYCLE,
  isTargetLossError,
  resolveSegmentBrowserRecycle,
} from "./segmentRecycle.js";

describe("isTargetLossError", () => {
  it("matches the Chrome target-loss signatures seen in the field", () => {
    for (const msg of [
      "Protocol error (Page.captureScreenshot): Target closed",
      "Protocol error (Runtime.callFunctionOn): Target closed",
      "Attempted to use detached Frame 'B2CD611B9F8EF71674BEF3ABB0A9E0FD'.",
      "Protocol error: Session closed. Most likely the page has been closed.",
      "Target.closeTarget: Target closed",
    ]) {
      expect(isTargetLossError(new Error(msg))).toBe(true);
    }
  });
  it("does not match authoring or encoder errors", () => {
    expect(isTargetLossError(new Error("Chunk concat failed: Invalid data"))).toBe(false);
    expect(isTargetLossError(new Error("media_start_out_of_range"))).toBe(false);
    expect(isTargetLossError("Target closed")).toBe(false); // must be an Error
  });
});

describe("resolveSegmentBrowserRecycle", () => {
  it("defaults to 3 and accepts 0 as never", () => {
    expect(resolveSegmentBrowserRecycle({})).toBe(DEFAULT_SEGMENT_BROWSER_RECYCLE);
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "0" })).toBe(0);
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "1" })).toBe(1);
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "-2" })).toBe(
      DEFAULT_SEGMENT_BROWSER_RECYCLE,
    );
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "x" })).toBe(
      DEFAULT_SEGMENT_BROWSER_RECYCLE,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/segmentRecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/** Recycle the browser every N segments; 0 disables. ~3 × 3000 frames keeps a session under the 10k-frame band (spec §2.5). */
export const DEFAULT_SEGMENT_BROWSER_RECYCLE = 3;

export function resolveSegmentBrowserRecycle(env: NodeJS.ProcessEnv): number {
  const raw = env.HF_SEGMENT_BROWSER_RECYCLE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SEGMENT_BROWSER_RECYCLE;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SEGMENT_BROWSER_RECYCLE;
}

const TARGET_LOSS_PATTERNS = [/target closed/i, /detached frame/i, /session closed/i];

/** The mid-capture Chrome target-loss class from spec §2.5. Encoder and authoring errors are not retried. */
export function isTargetLossError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return TARGET_LOSS_PATTERNS.some((re) => re.test(error.message));
}
```

- [ ] **Step 4: Run, commit**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/segmentRecycle.test.ts`
Expected: PASS.

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/segmentRecycle.ts packages/producer/src/services/render/segmentRecycle.test.ts
bunx oxlint packages/producer/src/services/render/segmentRecycle.ts packages/producer/src/services/render/segmentRecycle.test.ts
/usr/bin/git add packages/producer/src/services/render/segmentRecycle.ts packages/producer/src/services/render/segmentRecycle.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): target-loss classifier and browser recycle cadence for segments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Session factory, recycle, retry in the stage

**Files:**

- Modify: `packages/producer/src/services/render/stages/captureSegmentedStage.ts`
- Test: `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the stage test file. The fake session factory returns fresh fake sessions and records how many were created; the fake `captureFrame` can be scripted to throw a target-loss error on a chosen call.

```ts
function makeFactory(sessions: Array<ReturnType<typeof fakeSession>>) {
  const created: number[] = [];
  return {
    created,
    factory: {
      create: async () => {
        created.push(created.length);
        const s = sessions[Math.min(created.length - 1, sessions.length - 1)];
        return s;
      },
    },
  };
}

describe("runCaptureSegmentedStage recycle + retry", () => {
  it("recycles the browser every N segments", async () => {
    const { factory, created } = makeFactory([fakeSession(), fakeSession(), fakeSession()]);
    const closed: number[] = [];
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 12, probeSession: null }),
      segmentFrames: 3, // 4 segments
      browserRecycleEverySegments: 2, // recycle after segments 1 and 3 → 2 recycles, 3 sessions
      sessionFactory: factory,
      deps: {
        spawnEncoder: okEncoder(),
        captureFrame: okCapture(),
        concat: okConcat(),
        closeSession: async (s) => {
          closed.push(s.id);
        },
      },
    });
    expect(result.success && result.browserRecycles).toBe(2);
    expect(created.length).toBe(3);
    expect(closed.length).toBe(3); // every session closed exactly once
  });

  it("retries a segment once on target loss with a fresh session and deletes the partial file", async () => {
    const { factory, created } = makeFactory([fakeSession(), fakeSession()]);
    let calls = 0;
    const captureFrame = vi.fn(async (_s: unknown, i: number) => {
      calls += 1;
      if (calls === 5) throw new Error("Protocol error (Page.captureScreenshot): Target closed"); // frame index 4, segment 1
      return { buffer: Buffer.alloc(1) };
    });
    const removed: string[] = [];
    const observed: Array<Record<string, unknown>> = [];
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 6, probeSession: null }),
      segmentFrames: 3,
      browserRecycleEverySegments: 0,
      sessionFactory: factory,
      updateCaptureObservability: (p) => observed.push(p),
      deps: {
        spawnEncoder: okEncoder(),
        captureFrame,
        concat: okConcat(),
        removeFile: (p) => {
          removed.push(p);
        },
      },
    });
    expect(result.success && result.segmentRetries).toBe(1);
    expect(created.length).toBe(2);
    expect(removed).toEqual(["/work/segments/segment_00001.mp4"]);
    expect(captureFrame.mock.calls.map((c) => c[1])).toEqual([0, 1, 2, 3, 4, 3, 4, 5]);
    expect(observed).toContainEqual({ segmentRetries: 1 });
  });

  it("rethrows when the retried segment fails again", async () => {
    const { factory } = makeFactory([fakeSession(), fakeSession(), fakeSession()]);
    const captureFrame = vi.fn(async () => {
      throw new Error("Attempted to use detached Frame 'X'.");
    });
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 3, probeSession: null }),
        segmentFrames: 3,
        sessionFactory: factory,
        deps: { spawnEncoder: okEncoder(), captureFrame, concat: okConcat() },
      }),
    ).rejects.toThrow(/detached Frame/);
  });

  it("does not retry non-target-loss errors", async () => {
    const { factory, created } = makeFactory([fakeSession(), fakeSession()]);
    const captureFrame = vi.fn(async () => {
      throw new Error("media_start_out_of_range");
    });
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 3, probeSession: null }),
        segmentFrames: 3,
        sessionFactory: factory,
        deps: { spawnEncoder: okEncoder(), captureFrame, concat: okConcat() },
      }),
    ).rejects.toThrow(/media_start_out_of_range/);
    expect(created.length).toBe(1);
  });
});
```

`okEncoder()`, `okCapture()`, `okConcat()` are small helpers returning the always-succeeding fakes from the 2a tests; `fakeSession()` returns the 2a fake with an added numeric `id`. `SegmentedStageDeps` gains two seams: `closeSession: typeof closeCaptureSession` and `removeFile: (path: string) => void` (default `rmSync(path, { force: true })`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts`
Expected: FAIL — unknown inputs.

- [ ] **Step 3: Implement**

In `captureSegmentedStage.ts`:

(a) Imports: `import { isTargetLossError } from "../segmentRecycle.js"; import { rmSync } from "node:fs";`

(b) Types:

```ts
export interface SessionFactory {
  create(): Promise<CaptureSession>;
}
// SegmentedStageDeps += closeSession: typeof closeCaptureSession; removeFile: (path: string) => void;
// CaptureSegmentedStageInput += sessionFactory?: SessionFactory; browserRecycleEverySegments?: number;
//   updateCaptureObservability?: (patch: { capturePath?: "segmented"; segmentIndex?: number; segmentRetries?: number }) => void;
// success result += segmentRetries: number; browserRecycles: number;
```

(c) Default factory (preserves 2a behaviour when `sessionFactory` is absent):

```ts
const videoInjector = createRenderVideoFrameInjector();
let probeSession = input.probeSession;
const defaultFactory: SessionFactory = {
  create: async () => {
    const s =
      probeSession ??
      (await createCaptureSession(
        fileServer.url,
        framesDir,
        buildCaptureOptions(),
        createRenderVideoFrameInjector(),
        captureCfg,
      ));
    if (probeSession) {
      prepareCaptureSessionForReuse(s, framesDir, videoInjector);
      probeSession = null;
    }
    if (!s.isInitialized) await initializeSession(s);
    await completeDeferredDrawElementInit(s);
    return s;
  },
};
const factory = input.sessionFactory ?? defaultFactory;
const recycleEvery = input.browserRecycleEverySegments ?? 0;
```

(d) Replace the single-session body with a session holder and a per-segment function:

```ts
let session: CaptureSession = await factory.create();
let sessionSegments = 0;
let browserRecycles = 0;
let segmentRetries = 0;
let lastBrowserConsole: string[] = session.browserConsoleBuffer;

const recycleSession = async (why: "cadence" | "retry"): Promise<void> => {
  lastBrowserConsole = session.browserConsoleBuffer;
  dedupPerfs.push(getCapturePerfSummary(session));
  const mem = session.chromeMemory?.stats();
  await deps.closeSession(session);
  session = await factory.create();
  sessionSegments = 0;
  if (why === "cadence") browserRecycles += 1;
  log.info(`[Render] segment browser recycled (${why})`, {
    rendererRssPeakMb: mem?.rendererRssPeakMb,
    rssLastMb: mem?.rssLastMb,
    samples: mem?.samples,
  });
};

const captureSegment = async (segment: SegmentSlice, outputPath: string): Promise<number> => {
  const encoder = await deps.spawnEncoder(
    outputPath,
    {
      ...streamingEncoderOptions,
      lockGopForChunkConcat: true,
      gopSize: segment.endFrame - segment.startFrame,
    },
    abortSignal,
    cfg,
  );
  try {
    for (let i = segment.startFrame; i < segment.endFrame; i++) {
      assertNotAborted();
      const time = (i * job.config.fps.den) / job.config.fps.num;
      const { buffer } = await deps.captureFrame(session, i, time);
      const wrote = await encoder.writeFrame(buffer);
      if (!wrote)
        throw new Error(
          `[Render] segment ${segment.index}: encoder exited before frame ${i}: ${encoder.getExitError() ?? "unknown"}`,
        );
      job.framesRendered = i + 1;
      // progress update as in 2a
    }
  } catch (err) {
    await encoder.close().catch(() => {});
    deps.removeFile(outputPath);
    throw err;
  }
  const closed = await encoder.close();
  if (!closed.success)
    throw new Error(
      `[Render] segment ${segment.index} encode failed: ${closed.error ?? "unknown"}`,
    );
  return closed.durationMs;
};
```

(e) The main loop:

```ts
try {
  for (const segment of segments) {
    const outputPath = segmentOutputPath(segmentDir, segment.index);
    if (skip.has(segment.index)) {
      segmentPaths.push(outputPath);
      continue;
    }
    if (recycleEvery > 0 && sessionSegments >= recycleEvery) await recycleSession("cadence");
    input.updateCaptureObservability?.({ segmentIndex: segment.index });
    try {
      encodeMs += await captureSegment(segment, outputPath);
    } catch (err) {
      if (!isTargetLossError(err) || abortSignal?.aborted) throw err;
      segmentRetries += 1;
      input.updateCaptureObservability?.({ segmentRetries });
      log.warn(
        `[Render] segment ${segment.index}: browser target lost; retrying once on a fresh session`,
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      await recycleSession("retry");
      encodeMs += await captureSegment(segment, outputPath); // second failure propagates
    }
    sessionSegments += 1;
    segmentPaths.push(outputPath);
    // 2b: onSegmentComplete(...) here, after the successful close only
  }
  dedupPerfs.push(getCapturePerfSummary(session));
} catch (error) {
  lastBrowserConsole = session.browserConsoleBuffer;
  throw wrapCaptureStageError(error, lastBrowserConsole);
} finally {
  lastBrowserConsole = session.browserConsoleBuffer;
  await deps.closeSession(session);
}
```

Remove the 2a "probe the first encoder before the browser" block: with a factory the first spawn happens inside `captureSegment`. Keep the `success: false` fallback by wrapping the **first** `captureSegment` call's spawn: catch the spawn error before any frame was captured and return `{ success: false }` (only when `segmentPaths.length === 0` and no session frames were captured). Return `segmentRetries` and `browserRecycles` in the success result.

Important ordering for 2b: `onSegmentComplete` fires only after the (possibly retried) segment closes successfully, so a manifest never records a partial segment. `deps.removeFile` on retry also removes any stale file at that path.

- [ ] **Step 4: Run all stage tests and typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts && bunx tsc --noEmit -p .`
Expected: PASS (2a, 2b and 2c tests).

- [ ] **Step 5: Mutation check**

Change `if (!isTargetLossError(err) || abortSignal?.aborted) throw err;` to `throw err;` (no retry). Expected: "retries a segment once" FAILS and "does not retry non-target-loss errors" still passes. Restore.

- [ ] **Step 6: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
bunx oxlint packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git add packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): recycle the browser between segments and retry target loss once

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Orchestrator wiring and gate

**Files:**

- Modify: `packages/producer/src/services/renderOrchestrator.ts` (segmented branch)

- [ ] **Step 1: Pass the cadence**

In the segmented branch add `browserRecycleEverySegments: resolveSegmentBrowserRecycle(process.env),` (import from `../render/segmentRecycle.js`). Leave `sessionFactory` undefined so the stage's default factory (which reuses `probeSession` for the first session) applies. Include `segmentRetries` in the `updateCaptureObservability` patch type if TypeScript complains (Phase −1 declared the field).

- [ ] **Step 2: Typecheck + lane**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx tsc --noEmit -p . && node scripts/run-test-lane.mjs unit vitest`

- [ ] **Step 3: Manual gates**

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
cd /tmp/hf-longform && rm -rf a-single/renders
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 HF_SEGMENT_BROWSER_RECYCLE=1 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft --debug -o a-single/renders/phase2c.mp4 2>&1 | grep -aE 'browser recycled|segment complete|rendered in|Render failed'
ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/phase2c.mp4
```

Expected: five `browser recycled (cadence)` lines (six segments, recycle before segments 2–6), six `segment complete`, duration `300.000000`. Compare with the 2a output: `ffmpeg -i a-single/renders/phase2a.mp4 -i a-single/renders/phase2c.mp4 -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*'` → `average:inf` or ≥ 45 (a fresh session seeking to frame N produces the same pixels as a warm one; a lower number means a boundary bug and blocks the phase).

Simulated target loss: run with `HF_SEGMENT_FRAMES=1500` and, during segment 2, kill the renderer from another terminal: `pkill -f "chrome-headless-shell.*--type=renderer"`. Expected log: `browser target lost; retrying once on a fresh session`, then the render completes with `segment_retries: 1` in the debug `perf-summary.json` observability block.

- [ ] **Step 4: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/renderOrchestrator.ts
/usr/bin/git add packages/producer/src/services/renderOrchestrator.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): wire HF_SEGMENT_BROWSER_RECYCLE into segmented capture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review against the spec

- §5 Phase 2 item 2 "recycles it every HF_SEGMENT_BROWSER_RECYCLE segments (default: enough to cap a session near 10k captured frames)": default 3 × 3000 = 9,000 frames. Task 1, 3.
- Item 3 "a segment whose browser dies is retried once on a fresh session … logged with the segment index and the Phase −1 memory samples": Task 2 (`recycleSession` logs `rendererRssPeakMb`, `rssLastMb`, `samples`).
- §6 `segment_retries`: Task 2 via `updateCaptureObservability`.
- §8 "inject a simulated Target closed mid-segment; the segment retries on a fresh session": Task 2 unit test + Task 3 `pkill` gate.

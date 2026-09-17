# Phase 2a: Segmented capture, sequential, opt-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `HF_SEGMENTED_CAPTURE=true`, a single-worker mp4/mov render captures its frames in fixed-size segments, each streamed into its own ffmpeg process as a closed-GOP file, then concat-copies the segments into the video-only file the existing assemble stage muxes with audio. Output is frame-identical in structure to today's streaming output; scratch space is the encoded segments.

**Architecture:** A new capture plan kind `"sdr_segmented"` (capturePlan.ts) selects a new stage `runCaptureSegmentedStage` (mirrors `runCaptureStreamingStage`'s sequential branch). `planSegments()` splits `[0, totalFrames)` into `SegmentSlice`s of `HF_SEGMENT_FRAMES` (default 3000). For each segment the stage spawns `spawnStreamingEncoder` with `lockGopForChunkConcat: true, gopSize: framesInSegment` writing `segment_<k>.mp4`, captures frames with the same `captureFrameToBuffer` loop the streaming stage uses, closes the encoder, and moves on. After the last segment a new engine helper `concatVideoFiles` (extracted from the concat block in `chunkEncoder.ts` ~660) writes `videoOnlyPath`. The orchestrator then continues exactly as after a streaming stage (audio mux in `runAssembleStage`). One browser session for the whole render in this plan; recycling and retry are Phase 2c, manifest and resume are Phase 2b, multi-worker is 2d.

**Tech Stack:** TypeScript, puppeteer session (unchanged), ffmpeg concat demuxer, vitest.

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §5 "Phase 2" items 1, 2 (encoder part), 4; §6; §8.

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, no new dependencies.
- Tests: engine `cd packages/engine && bunx vitest run <file>`; producer `cd packages/producer && bunx vitest run <file>` (new tests import from `vitest` only; they land in the unit lane automatically).
- **Depends on Phase 0** (`explainStreamingEncodeGate`) and on Phase −1's `capturePath` / `segmentIndex` fields on `RenderCaptureObservability`. If Phase −1 has not landed when you start, add those two optional fields to `RenderCaptureObservability` (observability.ts, exact names from the README's shared-names table) as part of Task 5; do not skip the `updateCaptureObservability` calls and do not leave a TODO.
- Do not call the distributed `assemble()`; it requires a `planDir`. Do not use `lockWarmupTicks`; it is a Linux BeginFrame chunk-worker knob.
- Excluded outputs stay on their existing paths: `png-sequence`, `gif`, `webm` (VP9 concat-copy is fragile), HDR layered, shader-transition layered. Segmented applies to `mp4` and `mov` (H.264/H.265/ProRes go through `lockGopForChunkConcat`; ProRes is intra-only so GOP locking is a no-op for it).

---

## File map

| File                                                                               | Change                                                                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/producer/src/services/render/segmentPlan.ts` (new)                       | `SegmentSlice`, `planSegments`, `resolveSegmentFrames` (env).                                                                    |
| `packages/producer/src/services/render/segmentPlan.test.ts` (new)                  | Boundaries, remainder, env parsing.                                                                                              |
| `packages/engine/src/services/chunkEncoder.ts`                                     | Extract `buildConcatArgs` + `concatVideoFiles` from the block at ~660–690; use them inside `encodeFramesChunkedConcat`.          |
| `packages/engine/src/services/chunkEncoder.test.ts`                                | `buildConcatArgs` test.                                                                                                          |
| `packages/engine/src/index.ts`                                                     | Export `concatVideoFiles`.                                                                                                       |
| `packages/producer/src/services/render/capturePlan.ts`                             | `"sdr_segmented"` kind; `CreateCapturePlanInput.useSegmentedCapture`; fallback to `sdr_streaming` then `sdr_disk`.               |
| `packages/producer/src/services/render/capturePlan.test.ts`                        | New kind tests.                                                                                                                  |
| `packages/producer/src/services/render/stages/captureSegmentedStage.ts` (new)      | The stage.                                                                                                                       |
| `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts` (new) | Segment loop with fakes.                                                                                                         |
| `packages/producer/src/services/renderOrchestrator.ts`                             | Route selection (`HF_SEGMENTED_CAPTURE`), stage invocation next to the streaming stage call (~3854), `capturePath: "segmented"`. |
| `docs/`                                                                            | env var rows.                                                                                                                    |

---

### Task 1: `planSegments`

**Files:**

- Create: `packages/producer/src/services/render/segmentPlan.ts`
- Test: `packages/producer/src/services/render/segmentPlan.test.ts`

**Interfaces:**

- Produces:

```ts
export interface SegmentSlice {
  index: number;
  startFrame: number;
  endFrame: number;
} // [startFrame, endFrame)
export const DEFAULT_SEGMENT_FRAMES = 3000;
export const MIN_SEGMENT_FRAMES = 30;
/** Fixed-size slices; the last one is shorter. Throws on non-positive integers. */
export function planSegments(totalFrames: number, segmentFrames: number): SegmentSlice[];
/** HF_SEGMENT_FRAMES, clamped to >= MIN_SEGMENT_FRAMES; default 3000. */
export function resolveSegmentFrames(env: NodeJS.ProcessEnv): number;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_FRAMES,
  MIN_SEGMENT_FRAMES,
  planSegments,
  resolveSegmentFrames,
} from "./segmentPlan.js";

describe("planSegments", () => {
  it("covers [0, total) exactly with a shorter tail", () => {
    expect(planSegments(7, 3)).toEqual([
      { index: 0, startFrame: 0, endFrame: 3 },
      { index: 1, startFrame: 3, endFrame: 6 },
      { index: 2, startFrame: 6, endFrame: 7 },
    ]);
  });

  it("returns one segment when total <= segment size", () => {
    expect(planSegments(3, 3000)).toEqual([{ index: 0, startFrame: 0, endFrame: 3 }]);
  });

  it("rejects non-positive or fractional input", () => {
    expect(() => planSegments(0, 10)).toThrow(/totalFrames/);
    expect(() => planSegments(10, 0)).toThrow(/segmentFrames/);
    expect(() => planSegments(10.5, 3)).toThrow(/totalFrames/);
  });
});

describe("resolveSegmentFrames", () => {
  it("defaults to 3000", () => {
    expect(resolveSegmentFrames({})).toBe(DEFAULT_SEGMENT_FRAMES);
  });
  it("reads HF_SEGMENT_FRAMES and clamps to the minimum", () => {
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "600" })).toBe(600);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "5" })).toBe(MIN_SEGMENT_FRAMES);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "abc" })).toBe(DEFAULT_SEGMENT_FRAMES);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "12.7" })).toBe(DEFAULT_SEGMENT_FRAMES);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/segmentPlan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Segment planning for long-form capture (spec §5 Phase 2). A segment is a
 * half-open frame range captured into its own closed-GOP encoder process so
 * a crash costs one segment, not the render, and scratch is encoded video.
 */
export interface SegmentSlice {
  index: number;
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
}

/** ~100 s at 30 fps. Below the 10k-frame band where field crash rates pass 4 % (spec §2.5). */
export const DEFAULT_SEGMENT_FRAMES = 3000;
/** Tiny GOPs cost bitrate and per-encoder spawn overhead; 1 s at 30 fps is the floor. */
export const MIN_SEGMENT_FRAMES = 30;

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[segmentPlan] ${name} must be a positive integer (got ${String(value)})`);
  }
}

export function planSegments(totalFrames: number, segmentFrames: number): SegmentSlice[] {
  assertPositiveInteger("totalFrames", totalFrames);
  assertPositiveInteger("segmentFrames", segmentFrames);
  const slices: SegmentSlice[] = [];
  for (let start = 0, index = 0; start < totalFrames; start += segmentFrames, index += 1) {
    slices.push({
      index,
      startFrame: start,
      endFrame: Math.min(totalFrames, start + segmentFrames),
    });
  }
  return slices;
}

export function resolveSegmentFrames(env: NodeJS.ProcessEnv): number {
  const raw = env.HF_SEGMENT_FRAMES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SEGMENT_FRAMES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return DEFAULT_SEGMENT_FRAMES;
  return Math.max(MIN_SEGMENT_FRAMES, parsed);
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/segmentPlan.test.ts`
Expected: PASS.

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/segmentPlan.ts packages/producer/src/services/render/segmentPlan.test.ts
bunx oxlint packages/producer/src/services/render/segmentPlan.ts packages/producer/src/services/render/segmentPlan.test.ts
/usr/bin/git add packages/producer/src/services/render/segmentPlan.ts packages/producer/src/services/render/segmentPlan.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): segment planner for long-form capture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Extract `concatVideoFiles` in the engine

**Files:**

- Modify: `packages/engine/src/services/chunkEncoder.ts` (block at ~lines 660–690 inside `encodeFramesChunkedConcat`)
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/services/chunkEncoder.test.ts`

**Interfaces:**

- Produces:

```ts
/** Pure: the ffmpeg argv for a concat-demuxer stream copy, provenance args included. */
export function buildConcatArgs(concatListPath: string, outputPath: string): string[];
/** Writes `<dir of outputPath>/concat-list-<random>.txt`, runs ffmpeg `-f concat -c copy`, deletes the list. */
export async function concatVideoFiles(
  inputPaths: readonly string[],
  outputPath: string,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegEncodeTimeout">>,
): Promise<{ success: true } | { success: false; error: string }>;
```

- [ ] **Step 1: Write the failing test**

In `chunkEncoder.test.ts` (find an existing `describe` that imports from `./chunkEncoder.js` and add to the import list `buildConcatArgs`), add:

```ts
describe("buildConcatArgs", () => {
  it("stream-copies the concat list and writes provenance before the output", () => {
    const args = buildConcatArgs("/w/concat-list.txt", "/w/video-only.mp4");
    expect(args.slice(0, 8)).toEqual([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "/w/concat-list.txt",
      "-c",
      "copy",
    ]);
    expect(args.at(-2)).toBe("-y");
    expect(args.at(-1)).toBe("/w/video-only.mp4");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/services/chunkEncoder.test.ts -t buildConcatArgs`
Expected: FAIL — not exported.

- [ ] **Step 3: Extract**

In `chunkEncoder.ts`, above `export async function encodeFramesChunkedConcat(` add:

```ts
export function buildConcatArgs(concatListPath: string, outputPath: string): string[] {
  const args = ["-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy"];
  // The concat demuxer does not carry per-chunk container metadata into the
  // output, so provenance is re-asserted on the concatenated file.
  appendRenderProvenanceArgs(args, outputPath);
  args.push("-y", outputPath);
  return args;
}

function writeConcatList(dir: string, inputPaths: readonly string[]): string {
  const listPath = join(dir, `concat-list-${process.pid}-${Date.now()}.txt`);
  const body = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(listPath, body, "utf-8");
  return listPath;
}

/**
 * Stream-copy `inputPaths` (closed-GOP, same codec/params) into one file.
 * Used by the in-process chunked encode and by segmented capture.
 */
export async function concatVideoFiles(
  inputPaths: readonly string[],
  outputPath: string,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegEncodeTimeout">>,
): Promise<{ success: true } | { success: false; error: string }> {
  if (inputPaths.length === 0) return { success: false, error: "concatVideoFiles: no inputs" };
  mkdirSync(dirname(outputPath), { recursive: true });
  const listPath = writeConcatList(dirname(outputPath), inputPaths);
  const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
  try {
    const result = await runFfmpeg(buildConcatArgs(listPath, outputPath), {
      signal,
      timeout: encodeTimeout,
    });
    if (result.success) return { success: true };
    return {
      success: false,
      error: appendEncodeTimeoutMessage(
        `Chunk concat failed: ${result.stderr.slice(-400)}`,
        result.terminationReason === "deadline",
        encodeTimeout,
      ),
    };
  } finally {
    try {
      unlinkSync(listPath);
    } catch {
      // best effort
    }
  }
}
```

Add `unlinkSync` to the `fs` import at the top of the file. Then replace the original block inside `encodeFramesChunkedConcat` (from `const concatListPath = join(chunkDir, "concat-list.txt");` through the `if (!concatResult.success) { return {...} }` that follows) with:

```ts
const concatResult = await concatVideoFiles(chunkPaths, outputPath, signal, config);
if (!concatResult.success) {
  return {
    success: false,
    outputPath,
    durationMs: Date.now() - start,
    framesEncoded: 0,
    fileSize: 0,
    error: concatResult.error,
  };
}
```

Keep everything after that block as it was. Read the original block once more before deleting it to be sure the replacement returns the same `EncodeResult` shape (the fields above are the ones it used).

In `packages/engine/src/index.ts`, next to the existing `encodeFramesChunkedConcat` export, add `concatVideoFiles` and `buildConcatArgs`.

- [ ] **Step 4: Run the whole chunkEncoder test file and typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/services/chunkEncoder.test.ts && bunx tsc --noEmit -p .`
Expected: PASS (existing chunked-concat tests still green), typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/engine/src/services/chunkEncoder.ts packages/engine/src/services/chunkEncoder.test.ts packages/engine/src/index.ts
bunx oxlint packages/engine/src/services/chunkEncoder.ts packages/engine/src/services/chunkEncoder.test.ts packages/engine/src/index.ts
/usr/bin/git add packages/engine/src/services/chunkEncoder.ts packages/engine/src/services/chunkEncoder.test.ts packages/engine/src/index.ts
/usr/bin/git commit -F - <<'EOF'
refactor(engine): extract concatVideoFiles from the chunked encoder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: `sdr_segmented` capture plan kind

**Files:**

- Modify: `packages/producer/src/services/render/capturePlan.ts`
- Test: `packages/producer/src/services/render/capturePlan.test.ts`

**Interfaces:**

- Produces:

```ts
export interface SdrSegmentedCapturePlan extends CapturePlanBase {
  readonly kind: "sdr_segmented";
  readonly forceParallelStream: false;
}
export type CapturePlan =
  | SdrStreamingCapturePlan
  | SdrDiskCapturePlan
  | HdrLayeredCapturePlan
  | SdrSegmentedCapturePlan;
// CreateCapturePlanInput gains: useSegmentedCapture?: boolean;
// CapturePlanTarget.kind gains "sdr_segmented".
// replanAfterFailure: sdr_segmented + {kind:"streaming_unavailable"} → sdr_streaming (same base); sdr_segmented + draw_element_* → sdr_segmented with forceScreenshot: true.
```

- [ ] **Step 1: Write the failing tests**

Add to `capturePlan.test.ts` inside `describe("CapturePlan", …)`:

```ts
it("selects segmented capture only for single-worker streaming-eligible renders", () => {
  const plan = createCapturePlan({
    workerCount: 1,
    forceScreenshot: false,
    forceParallelStream: false,
    useStreamingEncode: true,
    useLayeredComposite: false,
    usePageSideCompositing: false,
    hasHdrContent: false,
    needsAlpha: false,
    useSegmentedCapture: true,
  });
  expect(plan).toMatchObject({ kind: "sdr_segmented", workerCount: 1, forceParallelStream: false });
  expect(Object.isFrozen(plan)).toBe(true);
});

it("does not segment when streaming is off or the route is layered", () => {
  const base = {
    workerCount: 1,
    forceScreenshot: false,
    forceParallelStream: false,
    usePageSideCompositing: false,
    hasHdrContent: false,
    needsAlpha: false,
    useSegmentedCapture: true,
  };
  expect(
    createCapturePlan({ ...base, useStreamingEncode: false, useLayeredComposite: false }).kind,
  ).toBe("sdr_disk");
  expect(
    createCapturePlan({ ...base, useStreamingEncode: true, useLayeredComposite: true }).kind,
  ).toBe("hdr_layered");
});

it("falls back from segmented to plain streaming when the encoder is unavailable", () => {
  const initial = createCapturePlan({
    workerCount: 1,
    forceScreenshot: false,
    forceParallelStream: false,
    useStreamingEncode: true,
    useLayeredComposite: false,
    usePageSideCompositing: false,
    hasHdrContent: false,
    needsAlpha: false,
    useSegmentedCapture: true,
  });
  const next = replanAfterFailure(initial, { kind: "streaming_unavailable" });
  expect(next.kind).toBe("sdr_streaming");
  expect(initial.kind).toBe("sdr_segmented");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/capturePlan.test.ts`
Expected: FAIL — `useSegmentedCapture` unknown / kind mismatch.

- [ ] **Step 3: Implement**

In `capturePlan.ts`:

(a) `CapturePlanTarget.kind`: `"sdr_streaming" | "sdr_disk" | "sdr_segmented"`.

(b) After `SdrDiskCapturePlan` add:

```ts
export interface SdrSegmentedCapturePlan extends CapturePlanBase {
  readonly kind: "sdr_segmented";
  readonly forceParallelStream: false;
}
```

and extend the union: `export type CapturePlan = SdrStreamingCapturePlan | SdrDiskCapturePlan | HdrLayeredCapturePlan | SdrSegmentedCapturePlan;`

(c) `CreateCapturePlanInput` gains `useSegmentedCapture?: boolean;`.

(d) In `createCapturePlan`, between the layered return and the streaming return:

```ts
if (input.useStreamingEncode && input.useSegmentedCapture === true && input.workerCount === 1) {
  return Object.freeze({ ...base, kind: "sdr_segmented", forceParallelStream: false });
}
```

(e) In `replanAfterFailure`, add at the top:

```ts
if (plan.kind === "sdr_segmented") {
  if (failure.kind === "streaming_unavailable") {
    return createCapturePlan({
      ...plan,
      useStreamingEncode: true,
      useLayeredComposite: false,
      useSegmentedCapture: false,
      forceParallelStream: false,
      routing: revertedRouting(plan.routing),
    });
  }
  if (failure.kind === "draw_element_verification" || failure.kind === "draw_element_capture") {
    return createCapturePlan({
      ...plan,
      forceScreenshot: true,
      useStreamingEncode: true,
      useLayeredComposite: false,
      useSegmentedCapture: true,
      forceParallelStream: false,
      routing: revertedRouting(plan.routing),
    });
  }
}
```

Read the existing branches of `replanAfterFailure` (lines ~175–240) to match how `routing` is passed for the other kinds; if they pass `plan.routing` untouched for `streaming_unavailable`, do the same. Then make sure the switch/if chain still handles every `(plan.kind, failure.kind)` pair the TypeScript exhaustiveness check expects (the file may end with an `assertNever`; the new kind must reach a return before it).

- [ ] **Step 4: Run and commit**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/capturePlan.test.ts && bunx tsc --noEmit -p .`
Expected: PASS. Typecheck will flag every `switch (plan.kind)` in the orchestrator that is now non-exhaustive; those sites are fixed in Task 5. If `tsc` fails only there, proceed to Task 4 and 5 before committing Task 3 + 5 together; otherwise commit now:

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/capturePlan.ts packages/producer/src/services/render/capturePlan.test.ts
/usr/bin/git add packages/producer/src/services/render/capturePlan.ts packages/producer/src/services/render/capturePlan.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): sdr_segmented capture plan kind

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: `runCaptureSegmentedStage`

**Files:**

- Create: `packages/producer/src/services/render/stages/captureSegmentedStage.ts`
- Test: `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts`

**Interfaces:**

- Consumes: `planSegments`, `resolveSegmentFrames` (Task 1); `concatVideoFiles` (Task 2); engine `createCaptureSession`, `initializeSession`, `completeDeferredDrawElementInit`, `prepareCaptureSessionForReuse`, `captureFrameToBuffer`, `closeCaptureSession`, `getCapturePerfSummary`, `spawnStreamingEncoder`, `StreamingEncoder` (all already imported by `captureStreamingStage.ts`; copy its import lines).
- Produces:

```ts
export interface CaptureSegmentedStageInput {
  fileServer: FileServerHandle;
  workDir: string;
  framesDir: string;
  videoOnlyPath: string;
  job: RenderJob;
  totalFrames: number;
  cfg: EngineConfig;
  plan: SdrSegmentedCapturePlan;
  log: ProducerLogger;
  probeSession: CaptureSession | null;
  outputFormat: string;
  streamingEncoderOptions: StreamingEncoderOptions; // same type the streaming stage takes
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  dedupPerfs: CapturePerfSummary[];
  segmentFrames: number;
  /** Test seam: defaults to the real engine functions. */
  deps?: Partial<SegmentedStageDeps>;
  /** (Phase −1) */
  updateCaptureObservability?: (patch: {
    capturePath?: "segmented";
    segmentIndex?: number;
  }) => void;
}
export interface SegmentedStageDeps {
  spawnEncoder: typeof spawnStreamingEncoder;
  captureFrame: typeof captureFrameToBuffer;
  concat: typeof concatVideoFiles;
}
export type CaptureSegmentedStageResult =
  | {
      success: true;
      encodeMs: number;
      probeSession: null;
      lastBrowserConsole: string[];
      workerCount: 1;
      segments: number;
      segmentPaths: string[];
    }
  | { success: false }; // encoder spawn failed on the first segment → caller replans to sdr_streaming
export function segmentOutputPath(workDir: string, index: number): string; // `${workDir}/segments/segment_${String(index).padStart(5, "0")}.mp4`
export async function runCaptureSegmentedStage(
  input: CaptureSegmentedStageInput,
): Promise<CaptureSegmentedStageResult>;
```

- [ ] **Step 1: Write the failing test**

Create `captureSegmentedStage.test.ts`. Read `captureStreamingStage.test.ts` first for how it fakes a `CaptureSession`, `FileServerHandle`, `RenderJob` and the engine functions (it uses `vi.mock("@hyperframes/engine", …)`); reuse its fake-session factory by copying it. Then:

```ts
import { describe, expect, it, vi } from "vitest";
import { runCaptureSegmentedStage, segmentOutputPath } from "./captureSegmentedStage.js";
// + the fake factories copied from captureStreamingStage.test.ts

describe("segmentOutputPath", () => {
  it("zero-pads so lexical order equals frame order", () => {
    expect(segmentOutputPath("/w", 7)).toBe("/w/segments/segment_00007.mp4");
  });
});

describe("runCaptureSegmentedStage", () => {
  it("spawns one encoder per segment, writes every frame once in order, then concats", async () => {
    const written: Array<{ segment: string; frame: number }> = [];
    const encoders: string[] = [];
    const spawnEncoder = vi.fn(async (outputPath: string) => {
      encoders.push(outputPath);
      return {
        writeFrame: async (buf: Buffer) => {
          written.push({ segment: outputPath, frame: buf.readUInt32BE(0) });
          return true;
        },
        close: async () => ({ success: true, durationMs: 5, fileSize: 1 }),
        getExitStatus: () => "success" as const,
        getExitError: () => undefined,
      };
    });
    const captureFrame = vi.fn(async (_session: unknown, frameIndex: number) => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(frameIndex, 0);
      return { buffer };
    });
    const concat = vi.fn(async () => ({ success: true as const }));
    const observed: unknown[] = [];

    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 7 }), // helper built from the copied fakes
      segmentFrames: 3,
      deps: { spawnEncoder, captureFrame, concat },
      updateCaptureObservability: (p) => observed.push(p),
    });

    expect(result.success).toBe(true);
    expect(encoders).toEqual([
      segmentOutputPath("/work", 0),
      segmentOutputPath("/work", 1),
      segmentOutputPath("/work", 2),
    ]);
    expect(written.map((w) => w.frame)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      written.filter((w) => w.segment.endsWith("segment_00001.mp4")).map((w) => w.frame),
    ).toEqual([3, 4, 5]);
    expect(concat).toHaveBeenCalledWith(
      encoders,
      "/work/video-only.mp4",
      undefined,
      expect.anything(),
    );
    expect(observed[0]).toEqual({ capturePath: "segmented", segmentIndex: 0 });
    expect(spawnEncoder.mock.calls[1]?.[1]).toMatchObject({
      lockGopForChunkConcat: true,
      gopSize: 3,
    });
    expect(spawnEncoder.mock.calls[2]?.[1]).toMatchObject({
      lockGopForChunkConcat: true,
      gopSize: 1,
    });
  });

  it("returns success:false when the first encoder cannot spawn", async () => {
    const spawnEncoder = vi.fn(async () => {
      throw new Error("ffmpeg missing");
    });
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 3 }),
      segmentFrames: 3,
      deps: { spawnEncoder },
    });
    expect(result).toEqual({ success: false });
  });

  it("throws when a later encoder fails to close cleanly", async () => {
    let n = 0;
    const spawnEncoder = vi.fn(async () => ({
      writeFrame: async () => true,
      close: async () =>
        n++ === 1
          ? { success: false, durationMs: 1, fileSize: 0, error: "boom" }
          : { success: true, durationMs: 1, fileSize: 1 },
      getExitStatus: () => "success" as const,
      getExitError: () => undefined,
    }));
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 4 }),
        segmentFrames: 2,
        deps: { spawnEncoder },
      }),
    ).rejects.toThrow(/segment 1/);
  });
});
```

`fakeStageInput` must set `workDir: "/work"`, `videoOnlyPath: "/work/video-only.mp4"`, a `job` with `config.fps = { num: 30, den: 1 }`, a `probeSession` that is an already-initialized fake session (so the stage does not call the real `createCaptureSession`), `dedupPerfs: []`, `assertNotAborted: () => {}`, `buildCaptureOptions: () => ({ width: 16, height: 16 })`, `createRenderVideoFrameInjector: () => null`, `cfg` from `DEFAULT_CONFIG` (imported from `@hyperframes/engine`), `log` as the no-op logger the streaming test uses, `streamingEncoderOptions: { fps: { num: 30, den: 1 }, width: 16, height: 16, codec: "h264", preset: "ultrafast", quality: 30 }` (match `StreamingEncoderOptions`'s required keys; the typechecker will list any missing).

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the stage**

Create `captureSegmentedStage.ts`. Copy the import block from `captureStreamingStage.ts` and trim to what is used, then:

```ts
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  captureFrameToBuffer,
  closeCaptureSession,
  completeDeferredDrawElementInit,
  concatVideoFiles,
  createCaptureSession,
  getCapturePerfSummary,
  initializeSession,
  prepareCaptureSessionForReuse,
  spawnStreamingEncoder,
  type BeforeCaptureHook,
  type CaptureOptions,
  type CapturePerfSummary,
  type CaptureSession,
  type EngineConfig,
  type StreamingEncoder,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js"; // match captureStreamingStage.ts's import path
import type { ProducerLogger } from "../../logger.js"; // idem
import {
  type ProgressCallback,
  type RenderJob,
  updateJobStatus,
} from "../../renderOrchestrator.js"; // idem — copy the exact specifiers the streaming stage uses
import type { SdrSegmentedCapturePlan } from "../capturePlan.js";
import { planSegments } from "../segmentPlan.js";
import type { StreamingEncoderOptions } from "./captureStreamingStage.js";
import { wrapCaptureStageError } from "./captureStreamingStage.js"; // export it from there if it is module-private today

export interface SegmentedStageDeps {
  spawnEncoder: typeof spawnStreamingEncoder;
  captureFrame: typeof captureFrameToBuffer;
  concat: typeof concatVideoFiles;
}

export interface CaptureSegmentedStageInput {
  fileServer: FileServerHandle;
  workDir: string;
  framesDir: string;
  videoOnlyPath: string;
  job: RenderJob;
  totalFrames: number;
  cfg: EngineConfig;
  plan: SdrSegmentedCapturePlan;
  log: ProducerLogger;
  probeSession: CaptureSession | null;
  outputFormat: string;
  streamingEncoderOptions: StreamingEncoderOptions;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  dedupPerfs: CapturePerfSummary[];
  segmentFrames: number;
  deps?: Partial<SegmentedStageDeps>;
  updateCaptureObservability?: (patch: {
    capturePath?: "segmented";
    segmentIndex?: number;
  }) => void;
}

export type CaptureSegmentedStageResult =
  | {
      success: true;
      encodeMs: number;
      probeSession: null;
      lastBrowserConsole: string[];
      workerCount: 1;
      segments: number;
      segmentPaths: string[];
    }
  | { success: false };

export function segmentOutputPath(workDir: string, index: number): string {
  return join(workDir, "segments", `segment_${String(index).padStart(5, "0")}.mp4`);
}

/**
 * Sequential segmented capture: one browser session, one encoder per
 * segment, concat-copy at the end. Spec §5 Phase 2 (2a slice). Every frame
 * is captured exactly once; segment k holds frames [start, end).
 */
export async function runCaptureSegmentedStage(
  input: CaptureSegmentedStageInput,
): Promise<CaptureSegmentedStageResult> {
  const {
    fileServer,
    workDir,
    framesDir,
    videoOnlyPath,
    job,
    totalFrames,
    cfg,
    plan,
    log,
    streamingEncoderOptions,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    abortSignal,
    assertNotAborted,
    onProgress,
    dedupPerfs,
    segmentFrames,
  } = input;
  const deps: SegmentedStageDeps = {
    spawnEncoder: input.deps?.spawnEncoder ?? spawnStreamingEncoder,
    captureFrame: input.deps?.captureFrame ?? captureFrameToBuffer,
    concat: input.deps?.concat ?? concatVideoFiles,
  };
  const segments = planSegments(totalFrames, segmentFrames);
  const captureCfg: EngineConfig =
    cfg.forceScreenshot === plan.forceScreenshot
      ? cfg
      : { ...cfg, forceScreenshot: plan.forceScreenshot };
  mkdirSync(join(workDir, "segments"), { recursive: true });

  // Probe the encoder before touching the browser so an unavailable ffmpeg
  // replans to plain streaming exactly like the streaming stage does.
  let firstEncoder: StreamingEncoder;
  try {
    firstEncoder = await deps.spawnEncoder(
      segmentOutputPath(workDir, 0),
      {
        ...streamingEncoderOptions,
        lockGopForChunkConcat: true,
        gopSize: segments[0].endFrame - segments[0].startFrame,
      },
      abortSignal,
      cfg,
    );
    assertNotAborted();
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    log.warn("[Render] Segment encoder spawn failed; falling back to streaming capture.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false };
  }

  const videoInjector = createRenderVideoFrameInjector();
  let probeSession = input.probeSession;
  const session =
    probeSession ??
    (await createCaptureSession(
      fileServer.url,
      framesDir,
      buildCaptureOptions(),
      videoInjector,
      captureCfg,
    ));
  if (probeSession) {
    prepareCaptureSessionForReuse(session, framesDir, videoInjector);
    probeSession = null;
  }

  let lastBrowserConsole: string[] = [];
  const segmentPaths: string[] = [];
  let encodeMs = 0;
  let encoder: StreamingEncoder | null = firstEncoder;
  input.updateCaptureObservability?.({ capturePath: "segmented", segmentIndex: 0 });

  try {
    if (!session.isInitialized) await initializeSession(session);
    await completeDeferredDrawElementInit(session);
    assertNotAborted();
    lastBrowserConsole = session.browserConsoleBuffer;

    for (const segment of segments) {
      const outputPath = segmentOutputPath(workDir, segment.index);
      if (segment.index > 0) {
        encoder = await deps.spawnEncoder(
          outputPath,
          {
            ...streamingEncoderOptions,
            lockGopForChunkConcat: true,
            gopSize: segment.endFrame - segment.startFrame,
          },
          abortSignal,
          cfg,
        );
        input.updateCaptureObservability?.({ segmentIndex: segment.index });
      }
      const current: StreamingEncoder = encoder;
      for (let i = segment.startFrame; i < segment.endFrame; i++) {
        assertNotAborted();
        const time = (i * job.config.fps.den) / job.config.fps.num;
        const { buffer } = await deps.captureFrame(session, i, time);
        const wrote = await current.writeFrame(buffer);
        if (!wrote) {
          throw new Error(
            `[Render] segment ${segment.index}: encoder exited before frame ${i}: ${current.getExitError() ?? "unknown"}`,
          );
        }
        job.framesRendered = i + 1;
        if ((i + 1) % 30 === 0 || i + 1 === totalFrames) {
          updateJobStatus(
            job,
            "rendering",
            `Streaming frame ${i + 1}/${totalFrames} (segment ${segment.index + 1}/${segments.length})`,
            Math.round(25 + ((i + 1) / totalFrames) * 55),
            onProgress,
          );
        }
      }
      const closed = await current.close();
      encoder = null;
      if (!closed.success) {
        throw new Error(
          `[Render] segment ${segment.index} encode failed: ${closed.error ?? "unknown"}`,
        );
      }
      encodeMs += closed.durationMs;
      segmentPaths.push(outputPath);
      log.info("[Render] segment complete", {
        index: segment.index,
        frames: segment.endFrame - segment.startFrame,
        path: outputPath,
      });
    }
    dedupPerfs.push(getCapturePerfSummary(session));
  } catch (error) {
    lastBrowserConsole = session.browserConsoleBuffer;
    throw wrapCaptureStageError(error, lastBrowserConsole);
  } finally {
    lastBrowserConsole = session.browserConsoleBuffer;
    await closeCaptureSession(session);
    if (encoder) await encoder.close().catch(() => {});
  }

  const concatStarted = Date.now();
  const concat = await deps.concat(segmentPaths, videoOnlyPath, abortSignal, cfg);
  if (!concat.success) throw new Error(`[Render] segment concat failed: ${concat.error}`);
  encodeMs += Date.now() - concatStarted;

  return {
    success: true,
    encodeMs,
    probeSession: null,
    lastBrowserConsole,
    workerCount: 1,
    segments: segments.length,
    segmentPaths,
  };
}
```

`wrapCaptureStageError` and `updateJobStatus`: locate them (`grep -n "function wrapCaptureStageError\|export function updateJobStatus" packages/producer/src/services/render/stages/captureStreamingStage.ts packages/producer/src/services/renderOrchestrator.ts`). If `wrapCaptureStageError` is not exported, add `export` to its declaration in `captureStreamingStage.ts` (one-word change). Match the import specifiers the streaming stage uses for `ProducerLogger`, `FileServerHandle`, `RenderJob`, `ProgressCallback`.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts && bunx tsc --noEmit -p .`
Expected: PASS (three tests) and typecheck clean except any orchestrator exhaustiveness errors from Task 3, which Task 5 fixes.

- [ ] **Step 5: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts packages/producer/src/services/render/stages/captureStreamingStage.ts
bunx oxlint packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git add packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts packages/producer/src/services/render/stages/captureStreamingStage.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): sequential segmented capture stage with per-segment encoders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Route selection and stage invocation in the orchestrator

**Files:**

- Modify: `packages/producer/src/services/renderOrchestrator.ts` (plan creation where `createCapturePlan({...})` is called with `useStreamingEncode`; stage dispatch near line ~3845–3900 where `capturePlan.kind` selects `runCaptureStreamingStage`; every `switch (capturePlan.kind)` / `plan.kind === "sdr_streaming"` site tsc flagged in Task 3)
- Test: `packages/producer/src/services/renderOrchestrator.test.ts` (pure helper test)

**Interfaces:**

- Produces:

```ts
/** HF_SEGMENTED_CAPTURE === "true" (2a opt-in). Phase 2d flips the default. */
export function isSegmentedCaptureRequested(env: NodeJS.ProcessEnv): boolean;
```

- [ ] **Step 1: Write the failing test**

In `renderOrchestrator.test.ts`, near the Phase 1 `isCaptureParallelStreamRouterEnabled` tests, add:

```ts
describe("isSegmentedCaptureRequested", () => {
  it("is opt-in via HF_SEGMENTED_CAPTURE=true", () => {
    expect(isSegmentedCaptureRequested({})).toBe(false);
    expect(isSegmentedCaptureRequested({ HF_SEGMENTED_CAPTURE: "true" })).toBe(true);
    expect(isSegmentedCaptureRequested({ HF_SEGMENTED_CAPTURE: "false" })).toBe(false);
  });
});
```

Import it from `./renderOrchestrator.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/renderOrchestrator.test.ts -t isSegmentedCaptureRequested`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

(a) Add near `isCaptureParallelStreamRouterEnabled`:

```ts
/** Segmented capture opt-in (spec §5 Phase 2). Phase 2d makes it the default for long renders. */
export function isSegmentedCaptureRequested(env: NodeJS.ProcessEnv): boolean {
  return env.HF_SEGMENTED_CAPTURE?.trim().toLowerCase() === "true";
}
```

(b) Find where the capture plan is created: `grep -n "createCapturePlan({" packages/producer/src/services/renderOrchestrator.ts`. At each call that builds the initial SDR plan (not the HDR-layered one), add the input:

```ts
      useSegmentedCapture:
        isSegmentedCaptureRequested(process.env) &&
        workerCount === 1 &&
        (outputFormat === "mp4" || outputFormat === "mov") &&
        !hasHdrContent &&
        !compiled.hasShaderTransitions,
```

Use the same local names the surrounding code uses for HDR and shader-transition detection (they appear in the Phase 1 router args as `hasHdrContent || compiled.hasShaderTransitions`).

(c) In the stage dispatch (near line ~3845 the code reads `throw new Error(\`Cannot invoke streaming stage with ${capturePlan.kind} plan\`)`before calling`runCaptureStreamingStage`), add a sibling branch **before** the streaming branch:

```ts
if (capturePlan.kind === "sdr_segmented") {
  const segmentedPlan = capturePlan;
  resetCaptureAttemptProgress(job);
  return observeRenderStage(observability, "capture_segmented", captureStageObservationData(), () =>
    runCaptureSegmentedStage({
      fileServer: activeFileServer,
      workDir,
      framesDir,
      videoOnlyPath,
      job,
      totalFrames,
      cfg,
      plan: segmentedPlan,
      log,
      probeSession,
      outputFormat,
      streamingEncoderOptions: {
        // identical object to the streaming stage's options below,
        // minus the HLS gop lock (segments set their own).
        fps: job.config.fps,
        width,
        height,
        codec: preset.codec,
        preset: preset.preset,
        quality: effectiveQuality,
        bitrate: effectiveBitrate,
        pixelFormat: preset.pixelFormat,
        vp9CpuUsed: cfg.vp9CpuUsed,
        useGpu: job.config.useGpu,
        imageFormat: captureOptions.format || "jpeg",
        hdr: preset.hdr,
      },
      buildCaptureOptions,
      createRenderVideoFrameInjector,
      abortSignal,
      assertNotAborted,
      onProgress,
      dedupPerfs,
      segmentFrames: resolveSegmentFrames(process.env),
      updateCaptureObservability,
    }),
  );
}
```

Copy the `streamingEncoderOptions` object from the streaming branch that follows and delete only the HLS-specific `lockGopForChunkConcat`/`gopSize` lines. Import `runCaptureSegmentedStage` and `resolveSegmentFrames`. `observeRenderStage`'s phase-name type may be a union; add `"capture_segmented"` to it (grep the type name in `observability.ts`).

(d) The stage result is consumed by the same code that consumes the streaming result (`success`, `encodeMs`, `probeSession`, `lastBrowserConsole`, `workerCount`). If the streaming result is narrowed by a type guard on `deDrainStats`, the segmented result omits it; make the consumer treat it as optional. When `success: false` returns, the existing `replanAfterFailure(plan, { kind: "streaming_unavailable" })` path re-dispatches; Task 3 makes that land on `sdr_streaming`.

(e) Fix every exhaustiveness error tsc reports from Task 3 (`switch (plan.kind)` in `capturePlan.ts` callers, `captureStageObservationData`, telemetry `capture_path` mapping if present).

- [ ] **Step 4: Typecheck, run the unit lane**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx tsc --noEmit -p . && node scripts/run-test-lane.mjs unit vitest`
Expected: clean and green.

- [ ] **Step 5: Manual gate**

Fixtures per `packages/producer/tests/long-form/README.md`:

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
cd /tmp/hf-longform && rm -rf a-single/renders
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft --debug -o a-single/renders/phase2a.mp4 2>&1 | grep -aE 'segment complete|segment concat|rendered in|Render failed' | head -12
ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/phase2a.mp4
ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 a-single/renders/phase2a.mp4
```

Expected: six `segment complete` lines (9000 frames / 1500), duration `300.000000`, `nb_read_frames` `9000`. Then PSNR against the Phase 0 output (`a-single/renders/phase0.mp4` if kept; otherwise re-render it without the env vars):

```sh
ffmpeg -i a-single/renders/phase0.mp4 -i a-single/renders/phase2a.mp4 -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*'
```

Expected: `average:` ≥ 45 (both are draft-quality H.264 of identical frames; a closed GOP every 1500 frames changes bits, not pictures). Check the debug perf summary shows `"capturePath":"segmented"` (Phase −1 field).

- [ ] **Step 6: Docs**

Add `HF_SEGMENTED_CAPTURE` and `HF_SEGMENT_FRAMES` rows to the same env-var table Phase 0/1 touched (`grep -rn "HF_CAPTURE_PARALLEL_STREAM" docs`), marked experimental.

- [ ] **Step 7: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts packages/producer/src/services/render/capturePlan.ts
bunx oxlint packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
/usr/bin/git add packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts packages/producer/src/services/render/capturePlan.ts packages/producer/src/services/render/observability.ts docs
/usr/bin/git commit -F - <<'EOF'
feat(producer): opt-in segmented capture route (HF_SEGMENTED_CAPTURE)

Single-worker mp4/mov renders capture into closed-GOP segments with one
ffmpeg per segment and concat-copy at the end. Falls back to plain
streaming when the encoder cannot spawn. Default remains off until Phase 2d.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review against the spec

- §5 Phase 2 item 1 (reuse chunk sizing): deliberately a simpler fixed-size planner (`planSegments`) instead of `resolveChunkPlan`, whose `maxParallelChunks` semantics are for a worker pool cap; the spec text was updated to reference `resolveChunkPlan` only for 2d's worker fan-out.
- Item 2 (per-segment `spawnStreamingEncoder` with `lockGopForChunkConcat`, `gopSize = framesInChunk`): Task 4. Browser recycling: Phase 2c.
- Item 3 (manifest, resume): Phase 2b.
- Item 4 (concat via `assemble()`): replaced by `concatVideoFiles` + existing `runAssembleStage`; spec updated.
- Item 5 (boundary PSNR gate): Task 5 step 5.
- Exclusions (VP9/webm, HDR, png-sequence, gif): Task 5 step 3(b).
- §6 `capture_path: "segmented"`, `segment_index`: Task 4 via `updateCaptureObservability`.
- §8 "peak scratch < 2 GB" holds: segments are encoded video.

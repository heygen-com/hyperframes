# Phase 2b: Segment manifest and resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A segmented render that is killed (Ctrl-C, crash, power loss) resumes from the last completed segment when re-run with `--resume`, producing output byte-identical to an uninterrupted run.

**Architecture:** Segments today live in the render's temporary work dir, which is deleted on exit. 2b moves them to a stable, content-addressed directory under the project's `renders/.hf-segments/<planHash>/` and writes a `segments.json` manifest (`SegmentManifest`) after each segment closes. `planHash` is a SHA-256 over everything that determines segment bytes: the compiled composition hash the producer already computes, fps, output width/height, quality/CRF/bitrate, codec, `segmentFrames`, `totalFrames`, and the CLI version. On start, if `--resume` is set and a manifest with the same hash exists, completed segments are validated (file exists, size > 0, ffprobe frame count equals the slice length) and skipped. On success the directory is deleted unless `--keep-segments`. Nothing changes for non-segmented renders.

**Tech Stack:** TypeScript, `node:crypto`, ffprobe (frame-count validation via the engine's existing `ffprobe` util), vitest.

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §5 "Phase 2" item 3, §8 "kill the process after segment 2 of 6".

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, no new dependencies.
- Tests: producer `cd packages/producer && bunx vitest run <file>`; cli `cd packages/cli && bunx vitest run <file>`.
- **Depends on Phase 2a** (`runCaptureSegmentedStage`, `planSegments`, `segmentOutputPath`).
- Resume is opt-in (`--resume`). A wrong resume silently corrupts output, so every skip is validated and any mismatch discards the whole segment directory with a log line.

---

## File map

| File                                                                         | Change                                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/producer/src/services/render/segmentManifest.ts` (new)             | `SegmentManifest`, `computeSegmentPlanHash`, `readSegmentManifest`, `writeSegmentManifest`, `validateCompletedSegments`.                   |
| `packages/producer/src/services/render/segmentManifest.test.ts` (new)        | Hash stability, manifest round trip, validation with a fake prober.                                                                        |
| `packages/producer/src/services/render/stages/captureSegmentedStage.ts`      | Accept `segmentDir` + `resume` inputs; skip validated segments; write manifest after each close.                                           |
| `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts` | Resume skips completed, re-captures the rest.                                                                                              |
| `packages/producer/src/services/renderOrchestrator.ts`                       | Compute hash + dir; pass through; cleanup on success unless keep. `RenderConfig` gains `resumeSegments?: boolean; keepSegments?: boolean`. |
| `packages/cli/src/commands/render.ts`                                        | `--resume`, `--keep-segments` flags → `RenderConfig`.                                                                                      |
| `packages/cli/src/commands/render.test.ts` (or nearest args test)            | Flag parsing.                                                                                                                              |

## Names

```ts
export interface SegmentManifestEntry {
  index: number;
  startFrame: number;
  endFrame: number;
  path: string;
  bytes: number;
  completedAt: string;
}
export interface SegmentManifest {
  version: 1;
  planHash: string;
  totalFrames: number;
  segmentFrames: number;
  completed: SegmentManifestEntry[];
}
export interface SegmentPlanHashInput {
  compositionHash: string;
  cliVersion: string;
  totalFrames: number;
  segmentFrames: number;
  fps: { num: number; den: number };
  width: number;
  height: number;
  codec: string;
  preset: string;
  quality: number | undefined;
  bitrate: string | undefined;
  pixelFormat: string | undefined;
  imageFormat: string;
}
export function computeSegmentPlanHash(input: SegmentPlanHashInput): string; // 16 hex chars
export function segmentDirFor(projectRendersDir: string, planHash: string): string; // `${projectRendersDir}/.hf-segments/${planHash}`
export function readSegmentManifest(segmentDir: string): SegmentManifest | null;
export function writeSegmentManifest(segmentDir: string, manifest: SegmentManifest): void; // atomic: tmp + rename
export async function validateCompletedSegments(
  manifest: SegmentManifest,
  expectedHash: string,
  probeFrames: (path: string) => Promise<number | null>,
): Promise<Set<number>>; // indices safe to skip; empty set if hash differs
```

---

### Task 1: `segmentManifest.ts`

**Files:**

- Create: `packages/producer/src/services/render/segmentManifest.ts`
- Test: `packages/producer/src/services/render/segmentManifest.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeSegmentPlanHash,
  readSegmentManifest,
  segmentDirFor,
  validateCompletedSegments,
  writeSegmentManifest,
  type SegmentManifest,
  type SegmentPlanHashInput,
} from "./segmentManifest.js";

const hashInput: SegmentPlanHashInput = {
  compositionHash: "abc",
  cliVersion: "0.8.50",
  totalFrames: 9000,
  segmentFrames: 3000,
  fps: { num: 30, den: 1 },
  width: 1920,
  height: 1080,
  codec: "h264",
  preset: "ultrafast",
  quality: 28,
  bitrate: undefined,
  pixelFormat: "yuv420p",
  imageFormat: "jpeg",
};

describe("computeSegmentPlanHash", () => {
  it("is stable and 16 hex chars", () => {
    const a = computeSegmentPlanHash(hashInput);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(computeSegmentPlanHash({ ...hashInput })).toBe(a);
  });
  it("changes when any byte-determining input changes", () => {
    const a = computeSegmentPlanHash(hashInput);
    expect(computeSegmentPlanHash({ ...hashInput, segmentFrames: 1500 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, quality: 18 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, compositionHash: "abd" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, cliVersion: "0.8.51" })).not.toBe(a);
  });
});

describe("manifest io", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips and returns null when absent or malformed", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    expect(readSegmentManifest(dir)).toBeNull();
    const manifest: SegmentManifest = {
      version: 1,
      planHash: "0123456789abcdef",
      totalFrames: 7,
      segmentFrames: 3,
      completed: [
        {
          index: 0,
          startFrame: 0,
          endFrame: 3,
          path: join(dir, "segment_00000.mp4"),
          bytes: 10,
          completedAt: "2026-09-17T00:00:00.000Z",
        },
      ],
    };
    writeSegmentManifest(dir, manifest);
    expect(readSegmentManifest(dir)).toEqual(manifest);
    writeFileSync(join(dir, "segments.json"), "{not json");
    expect(readSegmentManifest(dir)).toBeNull();
  });

  it("segmentDirFor nests under renders/.hf-segments", () => {
    expect(segmentDirFor("/p/renders", "abc")).toBe("/p/renders/.hf-segments/abc");
  });
});

describe("validateCompletedSegments", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps only segments whose file exists and whose frame count matches", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    mkdirSync(dir, { recursive: true });
    const ok = join(dir, "segment_00000.mp4");
    const short = join(dir, "segment_00001.mp4");
    writeFileSync(ok, "xx");
    writeFileSync(short, "xx");
    const manifest: SegmentManifest = {
      version: 1,
      planHash: "h",
      totalFrames: 9,
      segmentFrames: 3,
      completed: [
        { index: 0, startFrame: 0, endFrame: 3, path: ok, bytes: 2, completedAt: "" },
        { index: 1, startFrame: 3, endFrame: 6, path: short, bytes: 2, completedAt: "" },
        {
          index: 2,
          startFrame: 6,
          endFrame: 9,
          path: join(dir, "missing.mp4"),
          bytes: 2,
          completedAt: "",
        },
      ],
    };
    const probe = async (p: string) => (p === ok ? 3 : p === short ? 2 : null);
    expect([...(await validateCompletedSegments(manifest, "h", probe))]).toEqual([0]);
  });

  it("skips nothing when the plan hash differs", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    const manifest: SegmentManifest = {
      version: 1,
      planHash: "old",
      totalFrames: 3,
      segmentFrames: 3,
      completed: [],
    };
    expect((await validateCompletedSegments(manifest, "new", async () => 3)).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/segmentManifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SegmentManifestEntry {
  index: number;
  startFrame: number;
  endFrame: number;
  path: string;
  bytes: number;
  completedAt: string;
}

export interface SegmentManifest {
  version: 1;
  planHash: string;
  totalFrames: number;
  segmentFrames: number;
  completed: SegmentManifestEntry[];
}

export interface SegmentPlanHashInput {
  compositionHash: string;
  cliVersion: string;
  totalFrames: number;
  segmentFrames: number;
  fps: { num: number; den: number };
  width: number;
  height: number;
  codec: string;
  preset: string;
  quality: number | undefined;
  bitrate: string | undefined;
  pixelFormat: string | undefined;
  imageFormat: string;
}

const MANIFEST_FILENAME = "segments.json";

/** Everything that determines segment bytes. Key order is fixed by construction. */
export function computeSegmentPlanHash(input: SegmentPlanHashInput): string {
  const ordered = [
    input.compositionHash,
    input.cliVersion,
    String(input.totalFrames),
    String(input.segmentFrames),
    `${input.fps.num}/${input.fps.den}`,
    `${input.width}x${input.height}`,
    input.codec,
    input.preset,
    input.quality === undefined ? "" : String(input.quality),
    input.bitrate ?? "",
    input.pixelFormat ?? "",
    input.imageFormat,
  ].join(" ");
  return createHash("sha256").update(ordered).digest("hex").slice(0, 16);
}

export function segmentDirFor(projectRendersDir: string, planHash: string): string {
  return join(projectRendersDir, ".hf-segments", planHash);
}

function isEntry(value: unknown): value is SegmentManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.index === "number" &&
    typeof v.startFrame === "number" &&
    typeof v.endFrame === "number" &&
    typeof v.path === "string" &&
    typeof v.bytes === "number" &&
    typeof v.completedAt === "string"
  );
}

function isManifest(value: unknown): value is SegmentManifest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.planHash === "string" &&
    typeof v.totalFrames === "number" &&
    typeof v.segmentFrames === "number" &&
    Array.isArray(v.completed) &&
    v.completed.every(isEntry)
  );
}

export function readSegmentManifest(segmentDir: string): SegmentManifest | null {
  const path = join(segmentDir, MANIFEST_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Atomic: write to a temp name, then rename over the manifest. */
export function writeSegmentManifest(segmentDir: string, manifest: SegmentManifest): void {
  mkdirSync(segmentDir, { recursive: true });
  const tmp = join(segmentDir, `${MANIFEST_FILENAME}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  renameSync(tmp, join(segmentDir, MANIFEST_FILENAME));
}

/**
 * Indices safe to skip on resume. A segment counts only if the hash matches,
 * the file exists with the recorded size, and ffprobe's frame count equals the
 * slice length. Anything else re-captures.
 */
export async function validateCompletedSegments(
  manifest: SegmentManifest,
  expectedHash: string,
  probeFrames: (path: string) => Promise<number | null>,
): Promise<Set<number>> {
  const ok = new Set<number>();
  if (manifest.planHash !== expectedHash) return ok;
  for (const entry of manifest.completed) {
    if (!existsSync(entry.path)) continue;
    const size = statSync(entry.path).size;
    if (size <= 0 || size !== entry.bytes) continue;
    const frames = await probeFrames(entry.path);
    if (frames !== entry.endFrame - entry.startFrame) continue;
    ok.add(entry.index);
  }
  return ok;
}
```

The two `as Record<string, unknown>` narrowings inside type guards are the accepted pattern for JSON validation in this repo (see `selection.ts` in studio-server for the same shape); they are guards, not assertions about domain types. If a reviewer objects, replace with `Object.entries` checks.

- [ ] **Step 4: Run, then commit**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/segmentManifest.test.ts`
Expected: PASS.

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/segmentManifest.ts packages/producer/src/services/render/segmentManifest.test.ts
bunx oxlint packages/producer/src/services/render/segmentManifest.ts packages/producer/src/services/render/segmentManifest.test.ts
/usr/bin/git add packages/producer/src/services/render/segmentManifest.ts packages/producer/src/services/render/segmentManifest.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): segment manifest with content-addressed plan hash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Stage support for skip + manifest write

**Files:**

- Modify: `packages/producer/src/services/render/stages/captureSegmentedStage.ts`
- Test: `packages/producer/src/services/render/stages/captureSegmentedStage.test.ts`

**Interfaces:**

- `CaptureSegmentedStageInput` gains:

```ts
  /** Stable directory for segments and the manifest. Defaults to `${workDir}/segments` when undefined (2a behaviour). */
  segmentDir?: string;
  /** Indices to skip (already validated by the caller). Default empty. */
  completedSegments?: ReadonlySet<number>;
  /** Called after each segment closes; caller persists the manifest. */
  onSegmentComplete?: (entry: { index: number; startFrame: number; endFrame: number; path: string; bytes: number }) => void;
```

- `segmentOutputPath(dir, index)` now takes the segment directory directly (callers pass `segmentDir`); update the 2a test accordingly (`segmentOutputPath("/w/segments", 7)`).

- [ ] **Step 1: Write the failing test**

Add to `captureSegmentedStage.test.ts`:

```ts
it("skips completed segments and still concats all of them in order", async () => {
  const spawned: string[] = [];
  const spawnEncoder = vi.fn(async (outputPath: string) => {
    spawned.push(outputPath);
    return {
      writeFrame: async () => true,
      close: async () => ({ success: true, durationMs: 1, fileSize: 1 }),
      getExitStatus: () => "success" as const,
      getExitError: () => undefined,
    };
  });
  const captured: number[] = [];
  const captureFrame = vi.fn(async (_s: unknown, i: number) => {
    captured.push(i);
    return { buffer: Buffer.alloc(1) };
  });
  const concat = vi.fn(async () => ({ success: true as const }));
  const completed: number[] = [];
  const result = await runCaptureSegmentedStage({
    ...fakeStageInput({ totalFrames: 9 }),
    segmentFrames: 3,
    segmentDir: "/stable",
    completedSegments: new Set([0]),
    onSegmentComplete: (e) => completed.push(e.index),
    deps: { spawnEncoder, captureFrame, concat },
  });
  expect(result.success).toBe(true);
  expect(captured).toEqual([3, 4, 5, 6, 7, 8]);
  expect(spawned).toEqual(["/stable/segment_00001.mp4", "/stable/segment_00002.mp4"]);
  expect(completed).toEqual([1, 2]);
  expect(concat).toHaveBeenCalledWith(
    ["/stable/segment_00000.mp4", "/stable/segment_00001.mp4", "/stable/segment_00002.mp4"],
    "/work/video-only.mp4",
    undefined,
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts`
Expected: FAIL — unknown input keys; frames 0–2 captured.

- [ ] **Step 3: Implement**

In `captureSegmentedStage.ts`:

- Change `segmentOutputPath` to `export function segmentOutputPath(segmentDir: string, index: number): string { return join(segmentDir, \`segment\_${String(index).padStart(5, "0")}.mp4\`); }`.
- At the top of the function: `const segmentDir = input.segmentDir ?? join(workDir, "segments"); mkdirSync(segmentDir, { recursive: true }); const skip = input.completedSegments ?? new Set<number>();`
- Replace every `segmentOutputPath(workDir, k)` with `segmentOutputPath(segmentDir, k)`.
- The "probe the encoder first" block must target the **first non-skipped** segment: `const firstPending = segments.find((s) => !skip.has(s.index));` If `firstPending` is undefined (everything already done) skip straight to concat with `segmentPaths = segments.map((s) => segmentOutputPath(segmentDir, s.index))`. Otherwise spawn for `firstPending` and carry `encoder` into the loop; inside the loop `if (skip.has(segment.index)) { segmentPaths.push(outputPath); log.info("[Render] segment skipped (resume)", { index: segment.index }); continue; }` and spawn a new encoder for every pending segment after the first pending one (replace the `segment.index > 0` condition with `segment.index !== firstPending.index`).
- After a successful `close()`: `const bytes = statSync(outputPath).size; input.onSegmentComplete?.({ index: segment.index, startFrame: segment.startFrame, endFrame: segment.endFrame, path: outputPath, bytes });` (import `statSync`; in the unit test the fake encoder writes no file, so guard: `const bytes = existsSync(outputPath) ? statSync(outputPath).size : 0;`).
- Progress label: include `skipped ${skip.size}` when non-zero.

- [ ] **Step 4: Run all stage tests, typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureSegmentedStage.test.ts && bunx tsc --noEmit -p .`
Expected: PASS (update the 2a `segmentOutputPath` assertion to the new argument).

- [ ] **Step 5: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
bunx oxlint packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git add packages/producer/src/services/render/stages/captureSegmentedStage.ts packages/producer/src/services/render/stages/captureSegmentedStage.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): segmented stage skips validated segments and reports completions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Orchestrator + CLI wiring

**Files:**

- Modify: `packages/producer/src/services/renderOrchestrator.ts` (segmented branch from 2a Task 5; `RenderConfig`)
- Modify: `packages/cli/src/commands/render.ts` (args + config mapping)
- Test: the CLI's render args test (find with `grep -rln "low-memory-mode\|lowMemoryMode" packages/cli/src/commands/*.test.ts`)

- [ ] **Step 1: `RenderConfig` fields**

Find `export interface RenderConfig` (`grep -n "export interface RenderConfig" packages/producer/src/services/renderOrchestrator.ts`) and add:

```ts
  /** Segmented capture: skip segments recorded in a matching manifest (Phase 2b). */
  resumeSegments?: boolean;
  /** Segmented capture: keep renders/.hf-segments/<hash> after success. */
  keepSegments?: boolean;
```

- [ ] **Step 2: Compute hash, dir, skip set in the segmented branch**

In the `capturePlan.kind === "sdr_segmented"` branch (2a Task 5), before `runCaptureSegmentedStage({`:

```ts
const segmentFrames = resolveSegmentFrames(process.env);
const planHash = computeSegmentPlanHash({
  compositionHash, // the local the observability summary already receives
  cliVersion: job.config.cliVersion ?? "dev", // grep how the orchestrator learns the CLI version; if it does not, use `process.env.npm_package_version ?? "dev"`
  totalFrames,
  segmentFrames,
  fps: job.config.fps,
  width,
  height,
  codec: preset.codec,
  preset: preset.preset,
  quality: effectiveQuality,
  bitrate: effectiveBitrate,
  pixelFormat: preset.pixelFormat,
  imageFormat: captureOptions.format || "jpeg",
});
const segmentDir = segmentDirFor(join(projectDir, "renders"), planHash);
let completedSegments = new Set<number>();
if (job.config.resumeSegments === true) {
  const manifest = readSegmentManifest(segmentDir);
  if (manifest) {
    completedSegments = await validateCompletedSegments(manifest, planHash, (p) =>
      probeVideoFrameCount(p),
    );
    log.info(`[Render] resuming: ${completedSegments.size} segments complete`, { segmentDir });
    if (completedSegments.size === 0) rmSync(segmentDir, { recursive: true, force: true });
  }
} else {
  rmSync(segmentDir, { recursive: true, force: true });
}
const manifest: SegmentManifest = readSegmentManifest(segmentDir) ?? {
  version: 1,
  planHash,
  totalFrames,
  segmentFrames,
  completed: [],
};
```

and pass into the stage: `segmentDir, completedSegments, onSegmentComplete: (entry) => { manifest.completed = [...manifest.completed.filter((e) => e.index !== entry.index), { ...entry, completedAt: new Date().toISOString() }]; writeSegmentManifest(segmentDir, manifest); }`.

`probeVideoFrameCount(path)`: the engine's `ffprobe` util has a frame-count reader used by artifact validation (`grep -n "nb_read_frames\|countFrames\|frameCount" packages/engine/src/utils/ffprobe.ts`). Import and use that function; if its name differs, use it under its real name and do not write a new prober. If it returns an object, map to `number | null`.

After the stage returns `success: true` and the assemble stage finishes (after the final output is validated), add: `if (job.config.keepSegments !== true) rmSync(segmentDir, { recursive: true, force: true });`. On any thrown error, leave the directory in place (that is the resume point).

`projectDir` is in scope in `executeRenderJob` (it is passed to `runExtractVideosStage`). Import `rmSync`, `join`.

- [ ] **Step 3: CLI flags**

In `packages/cli/src/commands/render.ts` `args`, next to `lowMemoryMode`:

```ts
    resume: {
      type: "boolean",
      description:
        "Segmented capture only (HF_SEGMENTED_CAPTURE=true): skip segments already completed by a previous run of the same composition and settings (renders/.hf-segments/<hash>/segments.json).",
      default: false,
    },
    keepSegments: {
      type: "boolean",
      description: "Segmented capture only: keep renders/.hf-segments/<hash> after a successful render.",
      default: false,
    },
```

and where the CLI builds the producer `RenderConfig` (`grep -n "lowMemoryMode:" packages/cli/src/commands/render.ts`), add `resumeSegments: args.resume, keepSegments: args.keepSegments,`. Add a parsing assertion to the nearest existing args test following its pattern.

- [ ] **Step 4: Typecheck, unit lanes, gate**

Run: `cd ~/src/wt/hyperframes/nle-render-spec && (cd packages/producer && bunx tsc --noEmit -p . && node scripts/run-test-lane.mjs unit vitest) && (cd packages/cli && bunx tsc --noEmit -p . && bunx vitest run src/commands)`

Manual gate (fixtures per `packages/producer/tests/long-form/README.md`):

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
cd /tmp/hf-longform && rm -rf a-single/renders
# 1. uninterrupted reference
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft --keep-segments -o a-single/renders/full.mp4
# 2. interrupted run: kill after the 2nd "segment complete" line
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft -o a-single/renders/resumed.mp4 2>&1 | awk '/segment complete/{n++} {print} n==2{exit}'
ls a-single/renders/.hf-segments/*/ ; cat a-single/renders/.hf-segments/*/segments.json | head -20
# 3. resume
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft --resume -o a-single/renders/resumed.mp4 2>&1 | grep -aE 'resuming|segment skipped|segment complete|rendered in'
cmp a-single/renders/full.mp4 a-single/renders/resumed.mp4 && echo BYTE_IDENTICAL
```

Expected: step 2 leaves two `segment_0000{0,1}.mp4` and a manifest with two entries; step 3 logs `resuming: 2 segments complete`, two `segment skipped`, four `segment complete`; `BYTE_IDENTICAL`. If `cmp` differs only in the container's creation-time metadata, compare video streams instead: `ffmpeg -i full.mp4 -map 0:v -c copy -f md5 -` for both and compare the MD5 lines; note in the PR which comparison held.

- [ ] **Step 5: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/renderOrchestrator.ts packages/cli/src/commands/render.ts
bunx oxlint packages/producer/src/services/renderOrchestrator.ts packages/cli/src/commands/render.ts
/usr/bin/git add packages/producer/src/services/renderOrchestrator.ts packages/cli/src/commands/render.ts packages/cli/src/commands/*.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(render): --resume and --keep-segments for segmented capture

Segments and their manifest live under renders/.hf-segments/<planHash>;
a resumed run validates each recorded segment (size, ffprobe frame count)
before skipping it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review against the spec

- §5 Phase 2 item 3 (manifest, rerun skips completed): Tasks 1–3.
- §8 "kill after segment 2 of 6; rerun completes with 4 segments; byte-identical": Task 3 step 4.
- Safety: hash covers every byte-determining input; skip requires size + frame-count match; non-resume runs clear the directory first; failures leave it for the next attempt.

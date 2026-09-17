# Phase 0: Remove the single-worker streaming duration cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-worker render longer than 240 seconds streams frames into ffmpeg instead of being routed to raw-RGBA disk capture, and the streaming-gate log line says why a path was chosen.

**Architecture:** The gate `shouldUseStreamingEncode` in `packages/producer/src/services/renderOrchestrator.ts` returns `false` when `durationSeconds > cfg.streamingEncodeMaxDurationSeconds` (default 240). The cap's original reason (a total-render ffmpeg timeout) no longer exists since `ffmpegStreamingTimeout` became an inactivity timeout. We add a boolean `streamingEncodeDurationCapEnabled` (default `false`) so the cap is applied only when an operator turns it on, refactor the gate into `explainStreamingEncodeGate` that returns `{ enabled, reason }`, log the reason, and correct the disk-preflight error message that today points users at an env var that cannot help multi-worker renders. We also commit the long-form fixture generator used for manual gates.

**Tech Stack:** TypeScript, Node 22, bun, vitest, ffmpeg (manual gate only).

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §2.3 item 4, §3 "Deterministic", §5 "Phase 0", §6, §8.

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, no new dependencies.
- Tests: `cd packages/<pkg> && bunx vitest run <file>`. Producer tests must import from exactly one of `vitest` / `bun:test`.
- `Infinity` is NOT allowed as a config value: `assertEngineConfigNumber` (config.ts) rejects non-finite numbers. `0` already means "streaming never applies to a positive duration" in existing tests. Hence the boolean.

---

## File map

| File                                                                | Change                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/config.ts`                                     | Add `streamingEncodeDurationCapEnabled` to `EngineConfig` (near line 167), `DEFAULT_CONFIG` (near line 296), `BOOLEAN_ENGINE_CONFIG_FIELDS` (line 330–344), env resolution in `resolveConfig` (near line 858). Update the stale comment on `streamingEncodeMaxDurationSeconds`. |
| `packages/engine/src/config.test.ts`                                | Default + env tests (near lines 55 and 95–105).                                                                                                                                                                                                                                 |
| `packages/producer/src/services/renderOrchestrator.ts`              | Replace `shouldUseStreamingEncode` body (lines 1390–1426) with `explainStreamingEncodeGate` + thin wrapper; log `reason` at the `streaming-encode gate` log (line ~3540–3556).                                                                                                  |
| `packages/producer/src/services/renderOrchestrator.test.ts`         | Update `describe("shouldUseStreamingEncode")` (lines 552–605); add `describe("explainStreamingEncodeGate")`.                                                                                                                                                                    |
| `packages/producer/src/services/render/stages/captureStage.ts`      | Correct `assertDiskCaptureHeadroom` message (lines 181–201).                                                                                                                                                                                                                    |
| `packages/producer/src/services/render/stages/captureStage.test.ts` | Assert the new message text.                                                                                                                                                                                                                                                    |
| `packages/producer/tests/long-form/gen.mjs`                         | New fixture generator (spec §8).                                                                                                                                                                                                                                                |
| `packages/producer/tests/long-form/README.md`                       | How to generate the source and run the manual gates.                                                                                                                                                                                                                            |
| `docs/`                                                             | Any page mentioning `PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS` gets the new flag (Task 5 greps).                                                                                                                                                                          |

---

### Task 1: Config flag `streamingEncodeDurationCapEnabled`

**Files:**

- Modify: `packages/engine/src/config.ts` (interface ~167, `DEFAULT_CONFIG` ~296, `BOOLEAN_ENGINE_CONFIG_FIELDS` ~330, `resolveConfig` ~858)
- Test: `packages/engine/src/config.test.ts`

**Interfaces:**

- Produces: `EngineConfig.streamingEncodeDurationCapEnabled: boolean` (default `false`); env `PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED` (`"true"` / `"false"`, parsed by the existing `envBool` helper).

- [ ] **Step 1: Write the failing tests**

Open `packages/engine/src/config.test.ts`. Find the default-config test that contains `expect(config.streamingEncodeMaxDurationSeconds).toBe(240);` (line ~55) and add directly after it:

```ts
expect(config.streamingEncodeDurationCapEnabled).toBe(false);
```

Find the test `"clamps negative streaming encode duration cutoff env values to zero"` (line ~102). Add after that whole `it(...)` block:

```ts
it("reads the streaming duration cap enable flag from env", () => {
  setEnv("PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED", "true");

  const config = resolveConfig();
  expect(config.streamingEncodeDurationCapEnabled).toBe(true);
});

it("keeps the streaming duration cap disabled when the flag is unset", () => {
  const config = resolveConfig();
  expect(config.streamingEncodeDurationCapEnabled).toBe(false);
});
```

`setEnv` is the file's existing helper (used by the neighbouring tests); do not write a new one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/config.test.ts`
Expected: FAIL — `expected undefined to be false` on the default test and a type error / `undefined` on the env test.

- [ ] **Step 3: Add the field to the interface, default, boolean list and env resolution**

In `packages/engine/src/config.ts`:

(a) In the `EngineConfig` interface, replace the comment + field for `streamingEncodeMaxDurationSeconds` (near line 163–167) with:

```ts
/**
 * Max composition duration eligible for streaming encode (seconds). Only
 * applied when `streamingEncodeDurationCapEnabled` is true. Historical: the
 * 240 s default (#579) guarded a total-render ffmpeg timeout that became an
 * inactivity timeout in efc16a945, so the cap is off by default.
 */
streamingEncodeMaxDurationSeconds: number;
/**
 * Apply `streamingEncodeMaxDurationSeconds`. Default false: long single-worker
 * renders stream. Env: PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED.
 */
streamingEncodeDurationCapEnabled: boolean;
```

(b) In `DEFAULT_CONFIG` (near line 296), directly after `streamingEncodeMaxDurationSeconds: 240,` add:

```ts
  streamingEncodeDurationCapEnabled: false,
```

(c) In `BOOLEAN_ENGINE_CONFIG_FIELDS` (line ~330), after `"enableStreamingEncode",` add:

```ts
  "streamingEncodeDurationCapEnabled",
```

(d) In `resolveConfig`, directly after the `streamingEncodeMaxDurationSeconds: Math.max(0, envNum(...))` block (near line 862–869) add:

```ts
    streamingEncodeDurationCapEnabled: envBool(
      "PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED",
      DEFAULT_CONFIG.streamingEncodeDurationCapEnabled,
    ),
```

`envBool` is the helper already used two lines above for `enableStreamingEncode`; match its call shape exactly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/config.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck the engine package**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx tsc --noEmit -p .`
Expected: no errors. (If `Pick<EngineConfig, ...>` call sites in producer complain later, that is Task 2.)

- [ ] **Step 6: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/engine/src/config.ts packages/engine/src/config.test.ts
bunx oxlint packages/engine/src/config.ts packages/engine/src/config.test.ts
/usr/bin/git add packages/engine/src/config.ts packages/engine/src/config.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(engine): add streamingEncodeDurationCapEnabled config flag, default off

The 240 s streaming cap guarded a total-render ffmpeg timeout that became an
inactivity timeout in efc16a945. Keep the numeric value for operators, gate
its application behind a boolean that defaults to off.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: `explainStreamingEncodeGate` with reasons; cap applied only when enabled

**Files:**

- Modify: `packages/producer/src/services/renderOrchestrator.ts:1390-1426`
- Test: `packages/producer/src/services/renderOrchestrator.test.ts:552-605`

**Interfaces:**

- Consumes: `EngineConfig.streamingEncodeDurationCapEnabled` (Task 1).
- Produces:

```ts
export type StreamingEncodeGateReason =
  | "disabled_by_config"
  | "format_excluded"
  | "invalid_duration"
  | "duration_cap"
  | "low_memory_mode"
  | "parallel_forced"
  | "single_worker"
  | "multi_worker";

export interface StreamingEncodeGateDecision {
  enabled: boolean;
  reason: StreamingEncodeGateReason;
}

export function explainStreamingEncodeGate(
  cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds"> &
    Partial<Pick<EngineConfig, "lowMemoryMode" | "streamingEncodeDurationCapEnabled">>,
  outputFormat: NonNullable<RenderConfig["format"]>,
  workerCount: number,
  durationSeconds: number,
  forceParallelStream = false,
): StreamingEncodeGateDecision;

// unchanged signature, now `return explainStreamingEncodeGate(...).enabled`
export function shouldUseStreamingEncode(
  cfg,
  outputFormat,
  workerCount,
  durationSeconds,
  forceParallelStream = false,
): boolean;
```

`streamingEncodeDurationCapEnabled` is optional in the `Pick` so the many existing call sites and tests that pass two-field objects keep compiling; `undefined` means "cap off", matching the config default.

- [ ] **Step 1: Write the failing tests**

In `packages/producer/src/services/renderOrchestrator.test.ts`, inside `describe("shouldUseStreamingEncode", ...)` (starts line 552):

Replace the test `"keeps renders over the configured max duration on normal encoding"` (lines ~587–599) with:

```ts
it("ignores the duration cap unless streamingEncodeDurationCapEnabled is true", () => {
  expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 1, 240.001)).toBe(true);
  expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 1, 3600)).toBe(true);
  expect(
    shouldUseStreamingEncode(
      { ...streamingEnabledConfig, streamingEncodeDurationCapEnabled: true },
      "mp4",
      1,
      240.001,
    ),
  ).toBe(false);
  expect(
    shouldUseStreamingEncode(
      {
        enableStreamingEncode: true,
        streamingEncodeMaxDurationSeconds: 120,
        streamingEncodeDurationCapEnabled: true,
      },
      "mp4",
      1,
      120.001,
    ),
  ).toBe(false);
  expect(
    shouldUseStreamingEncode(
      { ...streamingEnabledConfig, streamingEncodeDurationCapEnabled: true },
      "mp4",
      1,
      240,
    ),
  ).toBe(true);
});
```

Add a new `describe` block directly after the `shouldUseStreamingEncode` describe's closing `});`:

```ts
describe("explainStreamingEncodeGate", () => {
  const cfg = {
    enableStreamingEncode: true,
    streamingEncodeMaxDurationSeconds: 240,
    lowMemoryMode: false,
  };

  it("names the reason for every decision", () => {
    expect(
      explainStreamingEncodeGate({ ...cfg, enableStreamingEncode: false }, "mp4", 1, 10),
    ).toEqual({ enabled: false, reason: "disabled_by_config" });
    expect(explainStreamingEncodeGate(cfg, "png-sequence", 1, 10)).toEqual({
      enabled: false,
      reason: "format_excluded",
    });
    expect(explainStreamingEncodeGate(cfg, "gif", 1, 10)).toEqual({
      enabled: false,
      reason: "format_excluded",
    });
    expect(explainStreamingEncodeGate(cfg, "mp4", 1, 0)).toEqual({
      enabled: false,
      reason: "invalid_duration",
    });
    expect(explainStreamingEncodeGate(cfg, "mp4", 1, Number.NaN)).toEqual({
      enabled: false,
      reason: "invalid_duration",
    });
    expect(
      explainStreamingEncodeGate(
        { ...cfg, streamingEncodeDurationCapEnabled: true },
        "mp4",
        1,
        300,
      ),
    ).toEqual({ enabled: false, reason: "duration_cap" });
    expect(
      explainStreamingEncodeGate(
        { ...cfg, streamingEncodeDurationCapEnabled: true, lowMemoryMode: true },
        "mp4",
        1,
        300,
      ),
    ).toEqual({ enabled: true, reason: "low_memory_mode" });
    expect(explainStreamingEncodeGate(cfg, "mp4", 3, 300, true)).toEqual({
      enabled: true,
      reason: "parallel_forced",
    });
    expect(explainStreamingEncodeGate(cfg, "mp4", 1, 300)).toEqual({
      enabled: true,
      reason: "single_worker",
    });
    expect(explainStreamingEncodeGate(cfg, "mp4", 2, 300)).toEqual({
      enabled: false,
      reason: "multi_worker",
    });
  });

  it("agrees with shouldUseStreamingEncode on every input", () => {
    const cases: Array<[typeof cfg, "mp4" | "webm" | "gif", number, number, boolean]> = [
      [cfg, "mp4", 1, 10, false],
      [cfg, "mp4", 2, 10, false],
      [cfg, "mp4", 2, 10, true],
      [cfg, "gif", 1, 10, false],
      [{ ...cfg, enableStreamingEncode: false }, "mp4", 1, 10, false],
    ];
    for (const [c, format, workers, duration, force] of cases) {
      expect(shouldUseStreamingEncode(c, format, workers, duration, force)).toBe(
        explainStreamingEncodeGate(c, format, workers, duration, force).enabled,
      );
    }
  });
});
```

Add `explainStreamingEncodeGate` to the import list at the top of the test file (the existing import from `"./renderOrchestrator.js"` at lines ~50–56 already lists `shouldUseStreamingEncode`; add the new name alphabetically).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/renderOrchestrator.test.ts -t "StreamingEncode"`
Expected: FAIL — `explainStreamingEncodeGate is not a function` / import error, and the cap test fails because 240.001 currently returns `false`.

- [ ] **Step 3: Implement**

In `packages/producer/src/services/renderOrchestrator.ts`, replace the whole `shouldUseStreamingEncode` function (lines 1390–1426, from `export function shouldUseStreamingEncode(` through its closing `}`) with:

```ts
export type StreamingEncodeGateReason =
  | "disabled_by_config"
  | "format_excluded"
  | "invalid_duration"
  | "duration_cap"
  | "low_memory_mode"
  | "parallel_forced"
  | "single_worker"
  | "multi_worker";

export interface StreamingEncodeGateDecision {
  enabled: boolean;
  /** Why `enabled` is what it is. Logged as `reason` on the streaming-encode gate line. */
  reason: StreamingEncodeGateReason;
}

type StreamingGateConfig = Pick<
  EngineConfig,
  "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds"
> &
  Partial<Pick<EngineConfig, "lowMemoryMode" | "streamingEncodeDurationCapEnabled">>;

/**
 * Decide whether captured frames stream into ffmpeg (bounded scratch) or land
 * on disk as raw RGBA (`frames × w × h × 4` bytes). Every `false` names the
 * gate that fired so the log line and telemetry can attribute disk-path
 * renders. Order matters and mirrors the historical predicate:
 * config → format → duration validity → duration cap → parallel override →
 * worker count.
 */
export function explainStreamingEncodeGate(
  cfg: StreamingGateConfig,
  outputFormat: NonNullable<RenderConfig["format"]>,
  workerCount: number,
  // Composition timeline duration in seconds.
  durationSeconds: number,
  // Per-render override (set by the DE parallel router or the non-DE
  // parallel-stream router) — see deParallelStreamForced's declaration in
  // executeRenderJob for why this is a parameter instead of an env-var read.
  forceParallelStream = false,
): StreamingEncodeGateDecision {
  if (!cfg.enableStreamingEncode) return { enabled: false, reason: "disabled_by_config" };
  if (outputFormat === "png-sequence" || outputFormat === "gif") {
    return { enabled: false, reason: "format_excluded" };
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { enabled: false, reason: "invalid_duration" };
  }
  // Low-memory mode already pins capture to one worker. Keep those renders on
  // the streaming path regardless of duration so captured frames are drained
  // directly into FFmpeg instead of accumulating hundreds of gigabytes of
  // data URIs / disk frames until Chrome OOMs.
  const capApplies =
    cfg.streamingEncodeDurationCapEnabled === true &&
    durationSeconds > cfg.streamingEncodeMaxDurationSeconds;
  if (capApplies) {
    if (cfg.lowMemoryMode) return { enabled: true, reason: "low_memory_mode" };
    return { enabled: false, reason: "duration_cap" };
  }
  // HF_DE_PARALLEL_STREAM (manual opt-in) / forceParallelStream (router):
  // allow multi-worker streaming for the interleaved produce paths.
  // Contiguous-chunk parallel streaming stalls (worker k+1's first frame
  // waits for ALL of worker k's), so this only makes sense with the
  // interleaved distribution the capture stage selects under the same
  // condition.
  if (forceParallelStream || process.env.HF_DE_PARALLEL_STREAM === "true") {
    return { enabled: true, reason: "parallel_forced" };
  }
  if (workerCount === 1) return { enabled: true, reason: "single_worker" };
  return { enabled: false, reason: "multi_worker" };
}

export function shouldUseStreamingEncode(
  cfg: StreamingGateConfig,
  outputFormat: NonNullable<RenderConfig["format"]>,
  workerCount: number,
  durationSeconds: number,
  forceParallelStream = false,
): boolean {
  return explainStreamingEncodeGate(
    cfg,
    outputFormat,
    workerCount,
    durationSeconds,
    forceParallelStream,
  ).enabled;
}
```

Note one behaviour change beyond the cap: previously `lowMemoryMode` with a duration over the cap returned `true` only through the cap branch; that is preserved (`low_memory_mode` reason). When the cap is off, low-memory renders fall through to `single_worker`, which is the same `true`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/renderOrchestrator.test.ts`
Expected: PASS. If the test `"keeps long single-worker renders streaming in low-memory mode"` (line ~601) fails, it expects `true` for `{lowMemoryMode: true}` at 411 s; with the cap off that is `true` via `single_worker`, so it should pass unchanged.

- [ ] **Step 5: Log the reason on the gate line**

In `renderOrchestrator.ts`, find the block (line ~3540) that begins `useStreamingEncode = shouldUseStreamingEncode(` and the `log.info("streaming-encode gate", {` that follows. Replace both with:

```ts
const streamingGate = explainStreamingEncodeGate(
  cfg,
  outputFormat,
  workerCount,
  job.duration,
  deParallelStreamForced || captureParallelStreamForced,
);
useStreamingEncode = streamingGate.enabled;
log.info("streaming-encode gate", {
  enabled: useStreamingEncode,
  reason: streamingGate.reason,
  configFlag: cfg.enableStreamingEncode,
  durationCapEnabled: cfg.streamingEncodeDurationCapEnabled,
  outputFormat,
  workerCount,
  durationSeconds: job.duration,
  maxDurationSeconds: cfg.streamingEncodeMaxDurationSeconds,
});
```

Keep every other line of that block as it was (the comment above it about re-resolving after the router stays).

- [ ] **Step 6: Typecheck and run the full producer unit lane**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx tsc --noEmit -p . && node scripts/run-test-lane.mjs unit vitest`
Expected: typecheck clean; unit lane green. If a test asserts the exact old `streaming-encode gate` log object shape, update it to include `reason` and `durationCapEnabled`.

- [ ] **Step 7: Mutation check**

Temporarily change `DEFAULT_CONFIG.streamingEncodeDurationCapEnabled` in `packages/engine/src/config.ts` to `true`, then run `cd packages/engine && bunx vitest run src/config.test.ts`. Expected: the default test FAILS. Restore `false`, rerun, expected PASS. Do not commit the mutation.

- [ ] **Step 8: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
bunx oxlint packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
/usr/bin/git add packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/renderOrchestrator.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): stream long single-worker renders; name the streaming gate reason

Apply the 240 s duration cap only when streamingEncodeDurationCapEnabled is
set. Extract explainStreamingEncodeGate so the gate log line carries a
`reason` (disabled_by_config, format_excluded, invalid_duration,
duration_cap, low_memory_mode, parallel_forced, single_worker,
multi_worker). A 300 s 1080p30 single-worker render now streams instead of
requesting 75 GB of raw-frame scratch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Correct the disk-capture preflight message

**Files:**

- Modify: `packages/producer/src/services/render/stages/captureStage.ts:181-201` (`assertDiskCaptureHeadroom`)
- Test: `packages/producer/src/services/render/stages/captureStage.test.ts`

**Interfaces:** none new. The thrown `Error` message changes; `render_error.error_message` telemetry will show the new text.

- [ ] **Step 1: Write the failing test**

In `captureStage.test.ts`, find the test `"fails before capture when estimated frames exceed available headroom"` (line ~32). Read how it calls `assertDiskCaptureHeadroom` (it passes a fake `freeDiskBytes`). Add a new test after it using the same call shape:

```ts
it("tells the user which routes still use disk capture, not a dead env var", () => {
  let message = "";
  try {
    assertDiskCaptureHeadroom(
      "/tmp/frames",
      9000,
      { width: 1920, height: 1080 } as CaptureOptions,
      () => 10 * 1e9,
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("Disk capture may need");
  expect(message).toContain("--workers 1");
  expect(message).toContain("--low-memory-mode");
  expect(message).not.toContain("PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS");
});
```

If the file already constructs `CaptureOptions` some other way (a helper or a full object), copy that instead of the `as CaptureOptions` shape; the global no-`as T` rule applies to source, and the existing test file's convention wins here. `CaptureOptions` is imported from `@hyperframes/engine`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureStage.test.ts`
Expected: FAIL on `not.toContain("PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS")` and on `toContain("--workers 1")`.

- [ ] **Step 3: Change the message**

In `captureStage.ts` replace the `throw new Error(` … `);` inside `assertDiskCaptureHeadroom` with:

```ts
throw new Error(
  `Disk capture may need ~${(headroom.estimatedBytes / 1e6).toFixed(1)} MB of temporary frame storage, ` +
    `but only ${(headroom.freeBytes / 1e6).toFixed(1)} MB is free at ${framesDir}. ` +
    "Disk capture stores every frame as raw RGBA; it is used for multi-worker renders " +
    "and for png-sequence, gif, HDR and shader-transition outputs. " +
    "Re-run with --workers 1 to stream frames into the encoder, use --low-memory-mode, " +
    "or free up disk space.",
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/stages/captureStage.test.ts`
Expected: PASS. Also grep for other tests asserting the old text: `grep -rn "if streaming is supported" packages/` — update any hit to the new text.

- [ ] **Step 5: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/stages/captureStage.ts packages/producer/src/services/render/stages/captureStage.test.ts
bunx oxlint packages/producer/src/services/render/stages/captureStage.ts packages/producer/src/services/render/stages/captureStage.test.ts
/usr/bin/git add packages/producer/src/services/render/stages/captureStage.ts packages/producer/src/services/render/stages/captureStage.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(producer): point the disk-capture preflight at routes that actually stream

The message told users to raise PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS,
which never helps a multi-worker render. Name the disk-path routes and the
two flags that change them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Commit the long-form fixture generator

**Files:**

- Create: `packages/producer/tests/long-form/gen.mjs`
- Create: `packages/producer/tests/long-form/README.md`

**Interfaces:**

- Produces: running `node gen.mjs` in a directory that contains `assets/long.mp4` writes `a-single/` and `c-clips60/` HyperFrames projects. Used by every later plan's manual gate.

- [ ] **Step 1: Create the generator**

Create `packages/producer/tests/long-form/gen.mjs`:

```js
// Long-form render fixtures (spec §8). Run from a scratch directory that
// already contains assets/long.mp4 (see README.md for the ffmpeg command).
//   DUR=300 node gen.mjs        # 5-minute fixtures (default)
//   DUR=2400 node gen.mjs       # 40-minute soak fixtures
import { mkdirSync, writeFileSync, linkSync, existsSync } from "node:fs";

const W = 1920;
const H = 1080;
const DUR = Number(process.env.DUR ?? "300");
if (!Number.isFinite(DUR) || DUR <= 0)
  throw new Error(`DUR must be a positive number, got ${process.env.DUR}`);
if (!existsSync("assets/long.mp4")) throw new Error("assets/long.mp4 missing; see README.md");

const comp = (
  body,
) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000}video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}#badge{position:absolute;right:40px;top:40px;font:700 64px sans-serif;color:#fff;background:rgba(0,0,0,.5);padding:8px 24px}</style></head><body>
<div id="root" data-composition-id="root" data-width="${W}" data-height="${H}" data-start="0" data-duration="${DUR}" data-no-timeline>
${body}
<div id="badge">overlay</div>
</div></body></html>`;

const single = () =>
  comp(
    `<video class="clip" id="v0" src="assets/long.mp4" data-start="0" data-duration="${DUR}" data-media-start="0" data-has-audio="true"></video>`,
  );

const clips = (n = 60) =>
  comp(
    Array.from({ length: n }, (_, i) => {
      const d = DUR / n;
      return `<video class="clip" id="v${i}" src="assets/long.mp4" data-start="${(i * d).toFixed(3)}" data-duration="${d.toFixed(3)}" data-media-start="${(i * d).toFixed(3)}" data-has-audio="true"></video>`;
    }).join("\n"),
  );

for (const [name, html] of Object.entries({ "a-single": single(), "c-clips60": clips() })) {
  mkdirSync(`${name}/assets`, { recursive: true });
  writeFileSync(`${name}/index.html`, html);
  if (!existsSync(`${name}/assets/long.mp4`))
    linkSync("assets/long.mp4", `${name}/assets/long.mp4`);
  writeFileSync(
    `${name}/hyperframes.json`,
    JSON.stringify({ name, fps: 30, width: W, height: H }, null, 2),
  );
}
console.log(`generated a-single c-clips60 (DUR=${DUR}s)`);
```

- [ ] **Step 2: Create the README**

Create `packages/producer/tests/long-form/README.md`:

````markdown
# Long-form render fixtures

Manual gates for `plans/long-form-render/`. Not part of the automated lanes (they render for minutes and need ~600 MB of source).

## Generate the source once

```sh
mkdir -p /tmp/hf-longform/assets && cd /tmp/hf-longform
ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -t 300 -c:v libx264 -preset ultrafast -crf 23 -g 30 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart assets/long.mp4
node <repo>/packages/producer/tests/long-form/gen.mjs
```

For the 40-minute soak fixture use `-t 2400` and `DUR=2400 node .../gen.mjs`.

## Run a gate against the worktree build

```sh
cd <repo> && bun run build
cd /tmp/hf-longform
node <repo>/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft -o a-single/renders/out.mp4
```

Check duration: `ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/out.mp4` → `300.000000`.

## Gates by phase

| Phase | Command                                                   | Expect                                                                                          |
| ----- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0     | `render a-single --fps 30 -w 1` (stock env)               | log `streaming-encode gate {"enabled":true,"reason":"single_worker",...}`; output 300.000 s     |
| 1     | `render a-single --fps 30 -w 4` (stock env)               | log `Parallel screenshot capture will stream to the encoder`; work dir < 2 GB; output 300.000 s |
| 2a    | `HF_SEGMENTED_CAPTURE=true render a-single --fps 30 -w 1` | `segment_*.mp4` in work dir; output 300.000 s; PSNR ≥ 45 dB vs the Phase 0 output               |
| 2b    | kill the 2a render at ~40 %, rerun with `--resume`        | log `resuming: N segments complete`; output byte-identical to an uninterrupted run              |
| 2c    | 2a with `HF_SEGMENT_BROWSER_RECYCLE=1`                    | one `[Render] segment browser recycled` line per segment; output unchanged                      |
| 2d    | 2a with `-w 4`                                            | four `segment worker` lines; output 300.000 s                                                   |

PSNR between two renders:

```sh
ffmpeg -i a.mp4 -i b.mp4 -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*'
```
````

- [ ] **Step 3: Smoke-run the generator syntax**

Run: `cd /tmp && mkdir -p hf-gen-smoke/assets && cd hf-gen-smoke && : > assets/long.mp4 && DUR=10 node ~/src/wt/hyperframes/nle-render-spec/packages/producer/tests/long-form/gen.mjs && ls a-single c-clips60 && cd /tmp && rm -rf hf-gen-smoke`
Expected: prints `generated a-single c-clips60 (DUR=10s)` and lists `assets hyperframes.json index.html` for both.

- [ ] **Step 4: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/tests/long-form/gen.mjs
/usr/bin/git add packages/producer/tests/long-form
/usr/bin/git commit -F - <<'EOF'
test(producer): add long-form render fixture generator and manual gate notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Docs and the Phase 0 manual gate

**Files:**

- Modify: whichever docs page mentions the env var (grep below)

- [ ] **Step 1: Find doc mentions**

Run: `cd ~/src/wt/hyperframes/nle-render-spec && grep -rn "PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS\|streaming encode.*240\|4-minute" docs packages/cli/src/commands/render.ts | grep -v node_modules`

- [ ] **Step 2: Update each hit**

For each docs hit, state: the duration cap is off by default; `PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED=true` turns it on and `PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS` sets its value; multi-worker renders still use disk capture until Phase 1. Keep the page's existing table or list format. If there are no hits, skip to Step 3.

- [ ] **Step 3: Build and run the Phase 0 gate**

Run:

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
mkdir -p /tmp/hf-longform/assets && cd /tmp/hf-longform
[ -f assets/long.mp4 ] || ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 300 -c:v libx264 -preset ultrafast -crf 23 -g 30 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart assets/long.mp4
node ~/src/wt/hyperframes/nle-render-spec/packages/producer/tests/long-form/gen.mjs
rm -rf a-single/renders
node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft -o a-single/renders/phase0.mp4 2>&1 | tee /tmp/hf-longform/phase0.log | grep -aoE 'streaming-encode gate \{[^}]*\}|rendered in [^"]{0,20}|Render failed'
ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/phase0.mp4
```

Expected: gate line contains `"enabled":true,"reason":"single_worker"`; render completes (about 2–3 minutes on an Apple Silicon laptop); duration `300.000000`. Before this phase the same command failed at preflight with the 75 GB message.

- [ ] **Step 4: Commit docs (if changed)**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
/usr/bin/git add docs
/usr/bin/git commit -F - <<'EOF'
docs: streaming duration cap is off by default; document the enable flag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review against the spec

- §5 Phase 0 "remove the single-worker duration cap": Task 1 + 2. Represented as a boolean because `Infinity` fails `assertEngineConfigNumber` and `0` has an existing meaning (spec text updated 2026-09-17 to say so).
- §5 Phase 0 "preflight message": Task 3.
- §6 "gate log line gains a `reason` field": Task 2 step 5 (moved here from Phase 1 because the reasons exist once the gate is refactored).
- §8 fixture generator "to be committed under `packages/producer/tests/long-form/gen.mjs`": Task 4.
- §8 integration gate "`a-single -w 1` stock config renders to 300.000 s": Task 5 step 3.
- §8 mutation check "flip the default cap back": Task 2 step 7.

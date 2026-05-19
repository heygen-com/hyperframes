/**
 * Distributed-render path for the regression harness.
 *
 * The regression harness has two modes:
 *
 *   - `in-process` (default) — calls `executeRenderJob`, the same path the
 *     `hyperframes render` CLI takes. This is what produced every existing
 *     `tests/<name>/output/output.mp4` golden baseline.
 *
 *   - `distributed-simulated` — calls `plan()` → `renderChunk()` per chunk
 *     → `assemble()` from `@hyperframes/producer/distributed`. No Temporal
 *     or Lambda involvement: the controller and chunk worker are both this
 *     process, but they go through the same artifact (planDir + frozen
 *     `meta/encoder.json` + per-chunk concat-copy) that a real fan-out
 *     would.
 *
 * Both modes share the per-fixture `minPsnr` threshold — distributed must
 * pass the same quality bar the in-process renderer passes against the
 * same frozen baseline. A separate {@link DISTRIBUTED_SIMULATED_MIN_PSNR_DB}
 * pathology floor catches the case where a fixture authored a permissive
 * threshold and distributed regresses to fully-black output. The 50 dB
 * "distributed vs in-process" contract is a per-render comparison
 * (fresh in-process vs fresh distributed); against the frozen baseline
 * file it's unreachable for either mode due to shared encoder/JPEG-
 * capture jitter, so the harness can't use it as a per-test gate.
 *
 * Not every fixture can run in distributed-simulated mode. Distributed mode
 * refuses HDR mp4, NTSC framerates, and non-{24,30,60} fps at plan time.
 * Fixtures that don't meet the constraints are skipped — the harness logs
 * the reason and the fixture is treated as "passed (skipped)" in
 * distributed-simulated mode.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Fps } from "@hyperframes/core";
import { assemble, plan, renderChunk } from "./distributed.js";

/**
 * Three-mode contract that backs `--mode=<value>` on the regression
 * harness CLI:
 *
 *   - `in-process` — `executeRenderJob`, the same path the CLI takes.
 *   - `distributed-simulated` — `plan` → `renderChunk` × N → `assemble`
 *     in-process. No adapter (no Temporal, no Lambda).
 *   - `lambda-local` — drives the OSS `@hyperframes/aws-lambda` handler
 *     dispatch through a filesystem-backed fake S3, so every event
 *     shape SFN sends in production also lands here. Catches regressions
 *     in event JSON / S3 path conventions without paying for a real AWS
 *     round-trip.
 */
export type HarnessMode = "in-process" | "distributed-simulated" | "lambda-local";

/**
 * Absolute pathology floor for `--mode=distributed-simulated` — catches
 * a chunk that renders fully-black against a fixture authored with a
 * permissive `minPsnr`. Non-pathological drift is caught by the fixture's
 * own threshold; both modes share the same encoder/JPEG-capture jitter
 * floor against the frozen baseline file, so the 50 dB distributed-vs-
 * in-process contract value is unreachable for either mode and isn't a
 * useful per-test gate.
 */
export const DISTRIBUTED_SIMULATED_MIN_PSNR_DB = 10;

/** Result of {@link checkDistributedSupport}. */
export type DistributedSupportResult = { supported: true } | { supported: false; reason: string };

/**
 * Decide whether a fixture's `renderConfig` is one the distributed pipeline
 * can actually run. Two hard gates:
 *
 *   - fps must be `{ num: 24|30|60, den: 1 }`. `DistributedRenderConfig.fps`
 *     accepts only the three integer values, and rationals like
 *     `{ num: 30000, den: 1001 }` (NTSC) trip the type system at the call
 *     site. We surface this gate in code rather than only in TS so the
 *     harness can skip the fixture cleanly instead of throwing.
 *   - hdr must not be `true`. Distributed mode is SDR-only at v1.
 *
 * Callers that want the structured reason can read it off the returned
 * `reason` field; the message is intended to be log-friendly.
 */
export function checkDistributedSupport(renderConfig: {
  fps: Fps;
  format?: "mp4" | "webm" | "mov" | "png-sequence";
  hdr?: boolean;
}): DistributedSupportResult {
  if (renderConfig.fps.den !== 1) {
    return {
      supported: false,
      reason: `non-integer fps ${renderConfig.fps.num}/${renderConfig.fps.den} (distributed mode requires fps.den=1)`,
    };
  }
  const fpsNum = renderConfig.fps.num;
  if (fpsNum !== 24 && fpsNum !== 30 && fpsNum !== 60) {
    return {
      supported: false,
      reason: `fps ${fpsNum} not in {24, 30, 60} (DistributedRenderConfig.fps is a closed set)`,
    };
  }
  if (renderConfig.hdr === true) {
    return {
      supported: false,
      reason: "hdr=true refused in distributed mode (HDR signaling re-apply not implemented)",
    };
  }
  return { supported: true };
}

/**
 * Inputs for {@link runDistributedSimulatedRender}. The harness has already
 * prepared `projectDir` (a working copy of the fixture's `src/` directory)
 * and `tempRoot` (where the harness writes its scratch artifacts).
 */
export interface RunDistributedSimulatedInput {
  /** Working copy of the fixture's `src/` — contains `index.html`. */
  projectDir: string;
  /** Scratch root for plan + chunks; must be a directory the harness owns. */
  tempRoot: string;
  /** Where to write the assembled final mp4 / mov / png-sequence directory. */
  renderedOutputPath: string;
  /** From the fixture's renderConfig — must pass `checkDistributedSupport`. */
  fps: 24 | 30 | 60;
  format: "mp4" | "mov" | "png-sequence" | "webm";
  /**
   * Codec for `format: "mp4"`. Defaults to `"h264"`; pass `"h265"` to
   * exercise the libx265 closed-GOP path. Ignored for non-mp4 formats —
   * `plan()` throws if codec is passed with a non-mp4 format.
   */
  codec?: "h264" | "h265";
  /** Optional chunkSize override; defaults to the plan's 240. */
  chunkSize?: number;
  /** Optional maxParallelChunks override; defaults to the plan's 16. */
  maxParallelChunks?: number;
  /** Forwarded to `plan()` and re-applied by `renderChunk()` at boot. */
  variables?: Record<string, unknown>;
}

/**
 * Run the distributed pipeline against a single fixture as if a fan-out
 * adapter were driving it. The three activities run serially in this
 * process — there is no Temporal, no Lambda, no S3 — so the planDir,
 * chunk outputs, and assembled output all live under `tempRoot`.
 *
 * Width and height are required by `DistributedRenderConfig` for cross-call
 * sanity but are not consulted at render time — `plan()` reads the
 * composition's `data-width` / `data-height` attributes and overrides
 * whatever the config carried. The harness passes a dummy 1920×1080 here
 * for that reason; if the contract ever changes, the fixture's authored
 * dimensions will flow through `PlanResult` and we can switch to using
 * those instead.
 */
export async function runDistributedSimulatedRender(
  input: RunDistributedSimulatedInput,
): Promise<void> {
  const planDir = join(input.tempRoot, "plan");
  const chunksDir = join(input.tempRoot, "chunks");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(chunksDir, { recursive: true });

  // Step A: plan. `plan()` throws when `codec` is set with a non-mp4 format,
  // but `codec: undefined` is a no-op — so we forward it directly for mp4
  // and elide it for the others rather than branching the entire config.
  // hdrMode is pinned to force-sdr so the harness's behavior is independent
  // of any future auto-detect changes.
  const planResult = await plan(
    input.projectDir,
    {
      fps: input.fps,
      // Required-by-type but overridden by the composition's `data-width` /
      // `data-height` attrs; any positive integer works.
      width: 1920,
      height: 1080,
      format: input.format,
      ...(input.format === "mp4" && input.codec !== undefined ? { codec: input.codec } : {}),
      chunkSize: input.chunkSize,
      maxParallelChunks: input.maxParallelChunks,
      hdrMode: "force-sdr",
    },
    planDir,
  );

  // Step B: render every chunk. Sequential to keep the harness predictable —
  // adapters in production are free to fan out; this code path's job is to
  // exercise the per-chunk activity itself.
  const chunkPaths: string[] = [];
  for (let i = 0; i < planResult.chunkCount; i++) {
    const chunkPath =
      input.format === "png-sequence"
        ? join(chunksDir, `chunk-${String(i).padStart(4, "0")}`)
        : join(chunksDir, `chunk-${String(i).padStart(4, "0")}.${input.format}`);
    await renderChunk(planDir, i, chunkPath);
    chunkPaths.push(chunkPath);
  }

  // Step C: assemble. `audio.aac` only exists when the composition has
  // audio — pass null otherwise so `assemble()` doesn't try to mux silence.
  const audioPath = join(planDir, "audio.aac");
  const audioForAssemble = existsSync(audioPath) ? audioPath : null;
  await assemble(planDir, chunkPaths, audioForAssemble, input.renderedOutputPath);
}

/**
 * Pick the PSNR threshold for a fixture given the harness mode. Both modes
 * share the fixture's authored `minPsnr` — distributed must clear the same
 * quality bar in-process clears against the same frozen baseline.
 * Distributed-simulated additionally lifts the threshold to
 * {@link DISTRIBUTED_SIMULATED_MIN_PSNR_DB} for fixtures with a permissive
 * authored threshold; that absolute floor catches fully-black-output
 * regressions independent of fixture tolerance.
 */
export function resolveMinPsnrForMode(mode: HarnessMode, fixtureMinPsnr: number): number {
  if (mode === "in-process") return fixtureMinPsnr;
  // `lambda-local` shares the distributed-simulated pathology floor —
  // both modes go through the same plan/renderChunk/assemble primitives.
  return Math.max(fixtureMinPsnr, DISTRIBUTED_SIMULATED_MIN_PSNR_DB);
}

/**
 * Parse `--mode=<value>` from a single CLI token. Returns the parsed mode
 * when the token matches the expected shape, `null` otherwise so the
 * caller can pass the token through to the next handler. Throws on a
 * known prefix with a bad value (`--mode=foo`) — surfacing a typo at
 * parse time is cheaper than discovering at render time.
 */
export function parseHarnessModeFlag(token: string): HarnessMode | null {
  if (token === "--mode=in-process") return "in-process";
  if (token === "--mode=distributed-simulated") return "distributed-simulated";
  if (token === "--mode=lambda-local") return "lambda-local";
  if (token.startsWith("--mode=")) {
    const value = token.slice("--mode=".length);
    throw new Error(
      `regression-harness: --mode must be 'in-process', 'distributed-simulated', or 'lambda-local' (got ${JSON.stringify(value)})`,
    );
  }
  return null;
}

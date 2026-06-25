/**
 * freezePlan — write the meta/{composition,encoder,chunks}.json + plan.json
 * manifest at the end of `plan()`, compute the planHash from the frozen
 * artifacts, and return the manifest path.
 *
 * Called from `services/distributed/plan.ts` after all earlier phases have
 * materialized their on-disk artifacts under `<planDir>/`. The function is
 * deliberately the last step so `planHash` is computed from the actual bytes
 * the chunk worker will read — not from intermediate values the controller
 * has in memory.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { Fps } from "@hyperframes/core";
import {
  canonicalJsonStringify,
  computePlanHash,
  type PlanAssetHash,
  type PlanDimensions,
  sha256Hex,
} from "./planHash.js";

/**
 * The encoder configuration locked in at plan time.
 */
export interface LockedRenderConfig {
  // Capture
  captureMode: "beginframe" | "screenshot";
  forceScreenshot: boolean;
  deviceScaleFactor: number;
  useLayeredHdrComposite: boolean;
  /** Hard-pinned to "software" in v1 distributed renders. */
  browserGpuMode: "software";
  warmupTicks: number;

  // Encode
  encoder:
    | "libx264-software"
    | "libx265-software"
    | "libvpx-vp9-software"
    | "prores-software"
    | "png-sequence";
  /**
   * Caller-supplied quality enum, persisted so chunk workers can rebuild
   * the matching `getEncoderPreset(quality, format, …)` instead of
   * inferring quality from the encoder discriminant (which loses
   * information when the encoder→quality table grows non-injective).
   */
  quality: "draft" | "standard" | "high";
  ffmpegVersion: string;
  preset: string;
  crf?: number;
  bitrate?: string;
  /**
   * VP9-only: new WebM plans persist the resolved libvpx-vp9 `-cpu-used`
   * value so distributed workers reproduce the controller's speed/quality
   * choice. Omitted for non-VP9 plans to avoid shifting unrelated planHash
   * baselines. Optional for compatibility with older WebM planDirs; workers
   * replay those with the historical distributed VP9 value.
   */
  vp9CpuUsed?: number;
  /** Equal to chunkSize for closed-GOP concat-copy. */
  gopSize: number;
  closedGop: true;
  forceKeyframes: "n=0";
  pixelFormat: string;

  // Chunking
  chunkSize: number;
  chunkCount: number;

  /** Snapshot of `PRODUCER_RUNTIME_*` env vars at plan time. */
  runtimeEnv: Record<string, string>;

  /**
   * Render-time variable overrides snapshotted at plan time. Chunk workers
   * re-inject these into the page as `window.__hfVariables` before the
   * first capture, so every chunk sees the same `getVariables()` resolution
   * the controller used to size the plan.
   *
   * Folded into the canonical encoder.json bytes that feed `planHash` —
   * two plans with different variables produce different hashes (the
   * intended behavior: different variables can produce different rendered
   * frames). Two plans with the same variables produce identical hashes
   * because canonical-JSON sorts object keys.
   *
   * Optional: omitted (undefined) when the caller doesn't pass variables;
   * stripped from the canonical JSON via the same `stripUndefined` pass
   * that handles `crf`/`bitrate`, so an absent value hashes the same as
   * before this field existed.
   */
  variables?: Record<string, unknown>;
}

export interface CompositionMetadataJson {
  durationSeconds: number;
  width: number;
  height: number;
  fps: Fps;
  videoCount: number;
  audioCount: number;
  imageCount: number;
}

export interface ChunkSliceJson {
  index: number;
  startFrame: number;
  /** Exclusive upper bound — chunk workers iterate frames in `[startFrame, endFrame)`. */
  endFrame: number;
}

/**
 * Inputs to `freezePlan`. `planDir` already contains `compiled/`,
 * `video-frames/`, and (optionally) `audio.aac` by the time freezePlan
 * runs — those are materialized by the upstream compile/probe/extract/audio
 * stages composed in `services/distributed/plan.ts`.
 */
export interface FreezePlanInput {
  /** Absolute path to the plan directory being frozen. */
  planDir: string;
  composition: CompositionMetadataJson;
  encoder: LockedRenderConfig;
  chunks: readonly ChunkSliceJson[];
  dimensions: PlanDimensions;
  producerVersion: string;
  /** Hash of the deterministic-font snapshot baked into the plan. */
  fontSnapshotSha: string;
  /** Composition duration in seconds (mirrors `composition.durationSeconds`; carried separately for `plan.json`). */
  durationSeconds: number;
  /** Total frame count, separately materialized for callers that read `plan.json` without parsing chunks.json. */
  totalFrames: number;
  /** Whether `<planDir>/audio.aac` was produced. */
  hasAudio: boolean;
}

export interface FreezePlanResult {
  /** Absolute path to `plan.json`. */
  planJsonPath: string;
  /** Content-addressed planHash; see {@link computePlanHash}. */
  planHash: string;
}

/**
 * Re-export the runtime-env snapshot helper for backward compatibility with
 * earlier imports from `./freezePlan`. The implementation lives in
 * `../runtimeEnvSnapshot.ts` — chunk workers re-apply the snapshot during
 * boot, so it needs to be importable without dragging in the freeze pipeline.
 */

/** The relative path inside `<planDir>/` to the compiled HTML. */
const COMPILED_INDEX_RELATIVE_PATH = "compiled/index.html";
/** Files whose contents are framing of the plan itself, not assets. */
const HASH_EXCLUDED_PLAN_FILES = new Set<string>([
  "plan.json",
  "meta/encoder.json",
  COMPILED_INDEX_RELATIVE_PATH,
]);

/**
 * Recursively drop keys whose value is `undefined`. Preserves arrays and
 * primitive leaves. Used to sanitize the `LockedRenderConfig` before
 * canonical-JSON serialization so optional fields collapse to "absent"
 * rather than tripping `canonicalJsonStringify`'s undefined-rejection.
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * Walk `<planDir>/` depth-first; return a sorted, deterministic list of
 * `{ planRelativePath, absolutePath }` entries. Symlinks are skipped — the
 * `extractVideosStage` materializes them when `materializeSymlinks: true`,
 * so anything that slips through is by definition something the caller did
 * not intend to expose to chunk workers across machines.
 */
function listPlanFiles(planDir: string): Array<{ planRelativePath: string; absolutePath: string }> {
  const results: Array<{ planRelativePath: string; absolutePath: string }> = [];
  const rootResolved = resolve(planDir);

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push({
          planRelativePath: relative(rootResolved, full)
            .split(/[\\/]+/)
            .join("/"),
          absolutePath: full,
        });
      }
    }
  }

  walk(rootResolved);
  results.sort((a, b) => (a.planRelativePath < b.planRelativePath ? -1 : 1));
  return results;
}

/**
 * Read `compiled/index.html` and SHA every other regular file under `<planDir>/`
 * except the ones whose contents constitute the plan framing itself. Returns
 * the compiled HTML bytes (mixed verbatim into `planHash`) and the
 * sorted-by-path asset hashes.
 */
function collectPlanAssetShas(planDir: string): {
  compositionHtml: Uint8Array;
  assets: PlanAssetHash[];
} {
  const files = listPlanFiles(planDir);
  let compositionHtml: Uint8Array | null = null;
  const assets: PlanAssetHash[] = [];
  for (const file of files) {
    if (file.planRelativePath === COMPILED_INDEX_RELATIVE_PATH) {
      compositionHtml = readFileSync(file.absolutePath);
      continue;
    }
    if (HASH_EXCLUDED_PLAN_FILES.has(file.planRelativePath)) continue;
    const bytes = readFileSync(file.absolutePath);
    assets.push({ path: file.planRelativePath, sha256: sha256Hex(bytes) });
  }
  if (compositionHtml === null) {
    throw new Error(
      `[freezePlan] compiled HTML missing at ${COMPILED_INDEX_RELATIVE_PATH} ` +
        `— upstream compile stage did not materialize the expected file.`,
    );
  }
  return { compositionHtml, assets };
}

/**
 * Read a frozen plan directory back from disk and recompute its
 * content-addressed `planHash` over the actual on-disk bytes — including
 * the canonical encoder JSON, which is written via
 * {@link canonicalJsonStringify} so reading the file gives us the exact
 * string that fed the controller's hash.
 *
 * Distributed chunk workers call this at boot to verify their planDir is
 * the same one the controller wrote: any mismatch (corrupted artifact,
 * partial S3 download, manual tampering) trips a non-retryable
 * `PLAN_HASH_MISMATCH` before the chunk renders.
 *
 * Throws if `plan.json` or `meta/encoder.json` are missing/malformed —
 * callers should catch those as `MISSING_PLAN_ARTIFACT` rather than
 * lumping them with hash drift.
 */
export function recomputePlanHashFromPlanDir(planDir: string): string {
  const planJsonPath = join(planDir, "plan.json");
  const encoderJsonPath = join(planDir, "meta", "encoder.json");
  if (!existsSync(planJsonPath)) {
    throw new Error(`[freezePlan] plan.json missing: ${planJsonPath}`);
  }
  if (!existsSync(encoderJsonPath)) {
    throw new Error(`[freezePlan] meta/encoder.json missing: ${encoderJsonPath}`);
  }

  const planJson = JSON.parse(readFileSync(planJsonPath, "utf-8")) as {
    producerVersion: string;
    ffmpegVersion: string;
    fontSnapshotSha: string;
    dimensions: PlanDimensions;
  };

  // Encoder JSON is consumed as raw bytes so the hashing input matches
  // the on-disk file byte-for-byte. Re-parsing + re-canonicalizing would
  // be susceptible to floating-point round-trip drift, JSON whitespace
  // normalization differences, and Node version skew on number printing.
  const encoderConfigCanonicalJson = readFileSync(encoderJsonPath, "utf-8");

  const { compositionHtml, assets } = collectPlanAssetShas(planDir);

  return computePlanHash({
    compositionHtml,
    assets,
    fontSnapshotSha: planJson.fontSnapshotSha,
    encoderConfigCanonicalJson,
    producerVersion: planJson.producerVersion,
    ffmpegVersion: planJson.ffmpegVersion,
    dimensions: planJson.dimensions,
  });
}

/**
 * Freeze a plan directory: write `meta/*.json` + top-level `plan.json`, then
 * compute `planHash` over the canonicalized contents.
 *
 * The encoder JSON is written via {@link canonicalJsonStringify} so the bytes
 * fed into {@link computePlanHash} match the bytes on disk exactly. Consumers
 * can re-validate a plan by hashing `meta/encoder.json` directly.
 */
export async function freezePlan(input: FreezePlanInput): Promise<FreezePlanResult> {
  const {
    planDir,
    composition,
    encoder,
    chunks,
    dimensions,
    producerVersion,
    fontSnapshotSha,
    durationSeconds,
    totalFrames,
    hasAudio,
  } = input;

  if (!existsSync(planDir)) {
    throw new Error(`[freezePlan] planDir does not exist: ${planDir}`);
  }

  const metaDir = join(planDir, "meta");
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true });

  writeFileSync(
    join(metaDir, "composition.json"),
    `${JSON.stringify(composition, null, 2)}\n`,
    "utf-8",
  );

  // `LockedRenderConfig` has optional fields (`crf`, `bitrate`) that may be
  // `undefined`. `canonicalJsonStringify` deliberately throws on `undefined`
  // — JSON has no representation for it, and allowing it would silently
  // collapse two distinct configs (`{crf: 23}` vs `{crf: 23, bitrate: undefined}`)
  // into the same hash. Strip undefined values before canonicalizing so the
  // hashed config matches what is realistically a "missing field".
  const encoderForCanonical = stripUndefined(encoder) as Record<string, unknown>;
  const encoderConfigCanonicalJson = canonicalJsonStringify(encoderForCanonical);
  writeFileSync(join(metaDir, "encoder.json"), encoderConfigCanonicalJson, "utf-8");

  writeFileSync(join(metaDir, "chunks.json"), `${JSON.stringify(chunks, null, 2)}\n`, "utf-8");

  const { compositionHtml, assets } = collectPlanAssetShas(planDir);

  const planHash = computePlanHash({
    compositionHtml,
    assets,
    fontSnapshotSha,
    encoderConfigCanonicalJson,
    producerVersion,
    ffmpegVersion: encoder.ffmpegVersion,
    dimensions,
  });

  const planJson = {
    planHash,
    producerVersion,
    ffmpegVersion: encoder.ffmpegVersion,
    fontSnapshotSha,
    dimensions,
    chunkCount: chunks.length,
    totalFrames,
    duration: durationSeconds,
    hasAudio,
  };
  const planJsonPath = join(planDir, "plan.json");
  writeFileSync(planJsonPath, `${JSON.stringify(planJson, null, 2)}\n`, "utf-8");

  return { planJsonPath, planHash };
}

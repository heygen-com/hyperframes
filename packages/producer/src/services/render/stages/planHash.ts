/**
 * planHash — content-addressed hash for distributed render plans.
 *
 * Hash contract:
 *
 *   planHash = sha256(
 *     SCHEMA_PREFIX
 *     ⊕ composition_html_bytes
 *     ⊕ asset_shas (sorted by relative path)
 *     ⊕ font_snapshot_sha
 *     ⊕ encoder_config_canonical_json
 *     ⊕ producer_version
 *     ⊕ ffmpeg_version
 *     ⊕ fps ⊕ width ⊕ height ⊕ format
 *   )
 *
 * Two invocations with identical inputs MUST produce the same hash.
 * Adapters use this to short-circuit `plan()` on workflow replay and to
 * detect cross-version mismatches via a typed PLAN_HASH_MISMATCH error
 * (defined in `errors.ts` and enumerated in `events.ts`).
 *
 * Pure utility; no caller exists yet — the distributed-render
 * `services/distributed/plan.ts` will compose it.
 *
 * ## Encoding contract
 *
 * Every string-typed component (`fontSnapshotSha`,
 * `encoderConfigCanonicalJson`, `producerVersion`, `ffmpegVersion`, asset
 * paths and shas, the dimensions tuple) is hashed as UTF-8. External
 * verifiers must encode the same way. Binary fields (`compositionHtml`)
 * are hashed verbatim.
 */

import { createHash } from "node:crypto";
import type { DistributedFormat } from "../../distributed/shared.js";

/**
 * Schema-version prefix mixed into every digest. Bump the trailing version
 * integer whenever the framing of `computePlanHash` changes (new fields,
 * new delimiter, new field order, etc.) so every cached plan from an older
 * producer is forced to mismatch and re-plan. This is impossible to
 * backfill, so a deliberate bump is the only correct action.
 */
const PLAN_HASH_SCHEMA_PREFIX = "hyperframes-plan-hash-v1\x00";

/**
 * 0x00 byte used to frame each `hash.update()` call. Hoisted to module
 * scope so it's not reallocated on every `computePlanHash` invocation.
 */
const FIELD_DELIMITER = Buffer.from([0x00]);

/**
 * SHA-256 hex digest of an asset, paired with its plan-relative path. Sort
 * order across an asset list is by `path` (byte-wise ascending) to keep the
 * digest deterministic regardless of filesystem walk order.
 */
export interface PlanAssetHash {
  /** Plan-relative path. Stable across machines (no absolute paths). */
  path: string;
  /** Hex-encoded sha256 of the asset bytes. */
  sha256: string;
}

/**
 * Render dimensions + frame rate that affect the encoded output. Kept as a
 * separate type so callers can reuse it for log lines and adapter payloads.
 */
export interface PlanDimensions {
  /** Frame rate numerator (e.g. 30 or 30000 for NTSC). */
  fpsNum: number;
  /** Frame rate denominator (e.g. 1 or 1001 for NTSC). */
  fpsDen: number;
  width: number;
  height: number;
  format: DistributedFormat;
}

export interface PlanHashInput {
  /** Raw bytes of `compiled/index.html` after recompile. */
  compositionHtml: Uint8Array;
  /** All non-HTML assets referenced from the composition, in any order. */
  assets: readonly PlanAssetHash[];
  /** Hash of the deterministic-font snapshot used to render. */
  fontSnapshotSha: string;
  /** Canonical-JSON serialization of `meta/encoder.json` (LockedRenderConfig). */
  encoderConfigCanonicalJson: string;
  /** `@hyperframes/producer` package version that produced the plan. */
  producerVersion: string;
  /** ffmpeg `--version` line (e.g. "ffmpeg version 6.1.1"). */
  ffmpegVersion: string;
  dimensions: PlanDimensions;
}

/**
 * Compute the content-addressed planHash for a frozen plan.
 *
 * The hash incorporates each component as a separate `update()` call after a
 * fixed delimiter byte; that prevents two distinct inputs from accidentally
 * sharing a hash if their concatenation happens to collide (e.g. asset count
 * vs. asset bytes).
 */
export function computePlanHash(input: PlanHashInput): string {
  const hash = createHash("sha256");

  hash.update(PLAN_HASH_SCHEMA_PREFIX, "utf8");

  hash.update(input.compositionHtml);
  hash.update(FIELD_DELIMITER);

  const sortedAssets = [...input.assets].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const asset of sortedAssets) {
    hash.update(asset.path, "utf8");
    hash.update(FIELD_DELIMITER);
    hash.update(asset.sha256, "utf8");
    hash.update(FIELD_DELIMITER);
  }

  hash.update(input.fontSnapshotSha, "utf8");
  hash.update(FIELD_DELIMITER);
  hash.update(input.encoderConfigCanonicalJson, "utf8");
  hash.update(FIELD_DELIMITER);
  hash.update(input.producerVersion, "utf8");
  hash.update(FIELD_DELIMITER);
  hash.update(input.ffmpegVersion, "utf8");
  hash.update(FIELD_DELIMITER);

  const d = input.dimensions;
  hash.update(`${d.fpsNum}/${d.fpsDen}x${d.width}x${d.height}x${d.format}`, "utf8");

  return hash.digest("hex");
}

/**
 * Canonical-JSON serialization helper. JSON keys are emitted in
 * byte-wise-sorted order recursively, with no whitespace. Used to feed the
 * encoder config into `computePlanHash` such that semantically-equal configs
 * produce equal hashes regardless of source key ordering.
 *
 * Supports the subset that LockedRenderConfig values use: primitives, plain
 * objects, and arrays. Throws on functions, symbols, BigInts, and Maps.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJsonStringify: non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`canonicalJsonStringify: unsupported value type ${typeof value}`);
}

/**
 * Convenience helper: sha256 a file path or buffer, return hex digest. Used
 * by the eventual `freezePlan` to hash assets on disk.
 */
export function sha256Hex(bytes: Uint8Array | string): string {
  const h = createHash("sha256");
  h.update(bytes);
  return h.digest("hex");
}

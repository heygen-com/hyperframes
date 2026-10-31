import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KindFeatures, KindGuess } from "@hyperframes/core/audio-analysis";
import type { AnalyzeOptions, Analysis } from "./analyze.js";
import type { AudioTarget } from "./targets.js";

const CACHE_VERSION = 1;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const probability = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

function isKindFeatures(value: unknown): value is KindFeatures {
  return (
    record(value) &&
    finite(value.duration) &&
    value.duration >= 0 &&
    [value.regularity, value.syllables, value.sustain].every(probability) &&
    (value.voiced === undefined || probability(value.voiced))
  );
}

function isKindGuess(value: unknown): value is KindGuess {
  return (
    record(value) &&
    typeof value.value === "string" &&
    ["sfx", "music", "voice", "mixed"].includes(value.value) &&
    probability(value.confidence) &&
    isKindFeatures(value.features)
  );
}

export interface KindCacheSource {
  dir: string;
  identity: string;
}

export function kindSourceIdentity(path: string): string {
  const { size, mtimeMs, ctimeMs, ino } = statSync(path);
  return JSON.stringify({ size, mtimeMs, ctimeMs, ino });
}

export function kindCacheFile(
  dir: string,
  target: AudioTarget,
  request: AnalyzeOptions,
  sampleRate: number,
  source = kindSourceIdentity(target.path),
): string {
  const key = JSON.stringify({
    version: CACHE_VERSION,
    path: target.path,
    source,
    clip: target.clip,
    sampleRate,
    quality: request.quality,
    provider: request.provider?.kind,
    options: request.options?.kind,
  });
  return join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
}

export function readKindCache(file: string | null): Analysis | null {
  if (file === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isKindGuess(value)) return null;
  return {
    analyzed: value.features.duration,
    values: { kind: value },
    provenance: { kind: "signal" },
    ladder: { kind: [{ provider: "signal", outcome: "answered" }] },
    warnings: [],
  };
}

export function writeKindCache(file: string, value: KindGuess): string | null {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, JSON.stringify(value));
    renameSync(temporary, file);
    return null;
  } catch {
    return "kind could not be cached; another query will analyze the clip again";
  } finally {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // A failed cache cleanup must not discard measured audio.
    }
  }
}

export function cacheKindAnalysis(file: string, analysis: Analysis): void {
  if (
    analysis.provenance.kind !== "signal" ||
    analysis.warnings.length ||
    !isKindGuess(analysis.values.kind)
  )
    return;
  const warning = writeKindCache(file, analysis.values.kind);
  if (warning) analysis.warnings.push(warning);
}

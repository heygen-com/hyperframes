// fallow-ignore-file complexity
/**
 * Pure helpers for the HDR passthrough parity harness: parse ffmpeg
 * psnr/ssim stats files, summarize per-frame series, compare ffprobe
 * results, classify which HDR path a render took from its log, and evaluate
 * the parity thresholds documented in README.md.
 *
 * Nothing in here touches the filesystem or spawns processes, so every rule
 * the harness enforces is covered by stats.test.ts.
 */

/** dB value used for a frame whose MSE is 0 (ffmpeg prints `inf`). */
export const PSNR_IDENTICAL_DB = 100;

export interface ParityThresholds {
  /** Mean of the per-frame `psnr_avg` (all planes), dB. */
  minMeanPsnrDb: number;
  /** Worst single frame `psnr_avg`, dB. */
  minFramePsnrDb: number;
  /** Mean of the per-frame SSIM `All`. */
  minMeanSsim: number;
  /** Worst single frame SSIM `All`. */
  minFrameSsim: number;
  /** Allowed container duration difference, in frames. */
  maxDurationDeltaFrames: number;
}

export const DEFAULT_THRESHOLDS: ParityThresholds = {
  minMeanPsnrDb: 45,
  minFramePsnrDb: 40,
  minMeanSsim: 0.99,
  minFrameSsim: 0.98,
  maxDurationDeltaFrames: 1,
};

export interface SeriesSummary {
  frames: number;
  min: number;
  mean: number;
  /** Zero-based index of the worst frame (first one on ties). */
  minIndex: number;
}

export interface PsnrSummary extends SeriesSummary {
  /** Frames with MSE 0, counted as {@link PSNR_IDENTICAL_DB} in min/mean. */
  identicalFrames: number;
}

function parseKeyValues(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of line.matchAll(/([A-Za-z_]+):(\S+)/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) fields.set(key, value);
  }
  return fields;
}

function summarize(values: readonly number[]): SeriesSummary {
  if (values.length === 0) return { frames: 0, min: Number.NaN, mean: Number.NaN, minIndex: -1 };
  let min = Number.POSITIVE_INFINITY;
  let minIndex = 0;
  let sum = 0;
  values.forEach((value, index) => {
    sum += value;
    if (value < min) {
      min = value;
      minIndex = index;
    }
  });
  return { frames: values.length, min, mean: sum / values.length, minIndex };
}

/**
 * Parse the file written by `psnr=stats_file=...`. Each line looks like
 * `n:1 mse_avg:0.52 mse_y:... psnr_avg:50.95 psnr_y:... psnr_u:... psnr_v:...`;
 * `psnr_avg` is `inf` when the frames are identical.
 */
export function parsePsnrStats(text: string): PsnrSummary {
  const values: number[] = [];
  let identicalFrames = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = parseKeyValues(line).get("psnr_avg");
    if (raw === undefined) continue;
    if (raw === "inf") {
      identicalFrames += 1;
      values.push(PSNR_IDENTICAL_DB);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`psnr stats: unparseable psnr_avg in "${line}"`);
    values.push(Math.min(value, PSNR_IDENTICAL_DB));
  }
  return { ...summarize(values), identicalFrames };
}

/**
 * Parse the file written by `ssim=stats_file=...`. Each line looks like
 * `n:1 Y:0.998 U:0.999 V:0.999 All:0.998 (27.3)`.
 */
export function parseSsimStats(text: string): SeriesSummary {
  const values: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = parseKeyValues(line).get("All");
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`ssim stats: unparseable All in "${line}"`);
    values.push(value);
  }
  return summarize(values);
}

/** The subset of an ffprobe report the harness compares. */
export interface ProbeSummary {
  videoCodec: string | null;
  videoProfile: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  frameRate: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  colorRange: string | null;
  codecTag: string | null;
  /** Packet count of the first video stream (`-count_packets`). */
  videoFrames: number | null;
  /** Container duration, seconds. */
  durationSec: number | null;
  /** Side-data types on the first decoded video frame (mastering display, CLL, ...). */
  frameSideData: string[];
  hasAudio: boolean;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_space?: string;
  color_range?: string;
  codec_tag_string?: string;
  nb_read_packets?: string;
  sample_rate?: string;
  channels?: number;
}

interface FfprobeFrame {
  side_data_list?: Array<{ side_data_type?: string }>;
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: { duration?: string };
  frames?: FfprobeFrame[];
}

function numberOrNull(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build a {@link ProbeSummary} from `ffprobe -count_packets -show_streams
 * -show_format -of json` output, plus optional `-show_frames` output for the
 * first video frame (for HDR side data).
 */
export function summarizeProbe(streamsJson: string, firstFrameJson?: string): ProbeSummary {
  const parsed = JSON.parse(streamsJson) as FfprobeJson;
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const frames = firstFrameJson ? ((JSON.parse(firstFrameJson) as FfprobeJson).frames ?? []) : [];
  const sideData = (frames[0]?.side_data_list ?? [])
    .map((entry) => entry.side_data_type)
    .filter((type): type is string => typeof type === "string")
    .sort();
  return {
    videoCodec: video?.codec_name ?? null,
    videoProfile: video?.profile ?? null,
    pixFmt: video?.pix_fmt ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    frameRate: video?.r_frame_rate ?? null,
    colorPrimaries: video?.color_primaries ?? null,
    colorTransfer: video?.color_transfer ?? null,
    colorSpace: video?.color_space ?? null,
    colorRange: video?.color_range ?? null,
    codecTag: video?.codec_tag_string ?? null,
    videoFrames: numberOrNull(video?.nb_read_packets),
    durationSec: numberOrNull(parsed.format?.duration),
    frameSideData: sideData,
    hasAudio: audio !== undefined,
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: numberOrNull(audio?.sample_rate),
    audioChannels: audio?.channels ?? null,
  };
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Fields that must match exactly between the layered and passthrough outputs. */
const EXACT_PROBE_FIELDS = [
  "videoCodec",
  "videoProfile",
  "pixFmt",
  "width",
  "height",
  "frameRate",
  "colorPrimaries",
  "colorTransfer",
  "colorSpace",
  "colorRange",
  "codecTag",
  "videoFrames",
  "hasAudio",
  "audioCodec",
  "audioSampleRate",
  "audioChannels",
] as const satisfies readonly (keyof ProbeSummary)[];

function formatValue(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

/** Compare the two outputs' container / stream metadata. */
export function compareProbes(
  reference: ProbeSummary,
  candidate: ProbeSummary,
  fps: number,
  thresholds: Pick<ParityThresholds, "maxDurationDeltaFrames"> = DEFAULT_THRESHOLDS,
): CheckResult[] {
  const results: CheckResult[] = EXACT_PROBE_FIELDS.map((field) => {
    const a = reference[field];
    const b = candidate[field];
    return {
      name: field,
      ok: a === b,
      detail: a === b ? formatValue(a) : `layered=${formatValue(a)} passthrough=${formatValue(b)}`,
    };
  });

  const sideA = reference.frameSideData.join(",");
  const sideB = candidate.frameSideData.join(",");
  results.push({
    name: "frameSideData",
    ok: sideA === sideB,
    detail: sideA === sideB ? `[${sideA}]` : `layered=[${sideA}] passthrough=[${sideB}]`,
  });

  if (reference.durationSec === null || candidate.durationSec === null) {
    results.push({ name: "duration", ok: false, detail: "duration missing from ffprobe" });
  } else {
    const delta = Math.abs(reference.durationSec - candidate.durationSec);
    const allowed = thresholds.maxDurationDeltaFrames / fps + 1e-3;
    results.push({
      name: "duration",
      ok: delta <= allowed,
      detail: `layered=${reference.durationSec.toFixed(3)}s passthrough=${candidate.durationSec.toFixed(
        3,
      )}s delta=${delta.toFixed(3)}s (allowed ${allowed.toFixed(3)}s)`,
    });
  }
  return results;
}

/** Expected HDR stream tags for a transfer, as ffprobe spells them. */
export function expectedHdrTags(
  transfer: "hlg" | "pq",
): Pick<ProbeSummary, "colorPrimaries" | "colorTransfer" | "colorSpace" | "pixFmt"> {
  return {
    colorPrimaries: "bt2020",
    colorTransfer: transfer === "hlg" ? "arib-std-b67" : "smpte2084",
    colorSpace: "bt2020nc",
    pixFmt: "yuv420p10le",
  };
}

/** Check one output carries the HDR tags the HDR encode path writes. */
export function checkHdrTags(
  label: string,
  probe: ProbeSummary,
  transfer: "hlg" | "pq",
): CheckResult[] {
  const expected = expectedHdrTags(transfer);
  return (Object.keys(expected) as Array<keyof typeof expected>).map((field) => ({
    name: `${label}.${field}`,
    ok: probe[field] === expected[field],
    detail: `expected ${formatValue(expected[field])}, got ${formatValue(probe[field])}`,
  }));
}

export function checkPixelParity(
  psnr: PsnrSummary,
  ssim: SeriesSummary,
  expectedFrames: number | null,
  thresholds: ParityThresholds = DEFAULT_THRESHOLDS,
): CheckResult[] {
  const results: CheckResult[] = [
    {
      name: "psnr.mean",
      ok: psnr.mean >= thresholds.minMeanPsnrDb,
      detail: `${psnr.mean.toFixed(2)} dB (>= ${thresholds.minMeanPsnrDb})`,
    },
    {
      name: "psnr.min",
      ok: psnr.min >= thresholds.minFramePsnrDb,
      detail: `${psnr.min.toFixed(2)} dB at frame ${psnr.minIndex} (>= ${thresholds.minFramePsnrDb})`,
    },
    {
      name: "ssim.mean",
      ok: ssim.mean >= thresholds.minMeanSsim,
      detail: `${ssim.mean.toFixed(5)} (>= ${thresholds.minMeanSsim})`,
    },
    {
      name: "ssim.min",
      ok: ssim.min >= thresholds.minFrameSsim,
      detail: `${ssim.min.toFixed(5)} at frame ${ssim.minIndex} (>= ${thresholds.minFrameSsim})`,
    },
  ];
  if (expectedFrames !== null) {
    results.push({
      name: "metrics.frames",
      ok: psnr.frames === expectedFrames && ssim.frames === expectedFrames,
      detail: `psnr=${psnr.frames} ssim=${ssim.frames} expected=${expectedFrames}`,
    });
  }
  return results;
}

/** Which HDR route a render took, read from its log. */
export type RenderPath =
  | { kind: "passthrough" }
  | { kind: "ineligible"; reason: string; detail?: string }
  | { kind: "passthrough_error"; detail?: string }
  | { kind: "layered" }
  | { kind: "unknown" };

/**
 * Classify a render from its combined stdout/stderr. The log lines come from
 * `hdrPassthrough/index.ts` (`[Render] HDR passthrough ...`) and the layered
 * stage's progress label (`Layered composite`).
 */
export function classifyRenderLog(log: string): RenderPath {
  // The CLI logger appends the job context as JSON after the message.
  const off = /HDR passthrough off: ([a-z_]+)(?: \((.*?)\))?(?:[ \t]+\{.*\})?[ \t]*$/m.exec(log);
  if (off?.[1]) return { kind: "ineligible", reason: off[1], detail: off[2] };
  const failed = /HDR passthrough failed[^\n]*/.exec(log);
  if (failed) {
    const detail = /"error":"((?:[^"\\]|\\.)*)"/.exec(failed[0])?.[1];
    return { kind: "passthrough_error", detail };
  }
  if (/HDR passthrough: overlay states captured/.test(log)) return { kind: "passthrough" };
  if (/Layered composite/i.test(log)) return { kind: "layered" };
  return { kind: "unknown" };
}

/**
 * The version string from `ffmpeg -version` output ("7.0.2-static"), or null.
 * Recorded with every report: `maskedmerge`'s 16-bit rounding matches the
 * layered blend exactly on ffmpeg 7 and 8 but is 1 LSB off on some partial-alpha
 * pixels on older releases, so "bit-identical" depends on it.
 */
export function parseFfmpegVersion(output: string): string | null {
  return /^ffmpeg version (\S+)/m.exec(output)?.[1] ?? null;
}

/** Overlay capture counts the passthrough logs once it has captured its states. */
export interface CaptureStats {
  states: number;
  candidates: number;
  captures: number;
  unique: number;
  captureMs: number;
}

/**
 * Reads the `HDR passthrough: overlay states captured {...}` line, whose JSON
 * meta the CLI logger appends after the message. Null when the line is
 * missing or its meta does not carry every count.
 */
export function parseCaptureStats(log: string): CaptureStats | null {
  const line = /HDR passthrough: overlay states captured[ \t]+(\{.*\})[ \t]*$/m.exec(log);
  if (!line?.[1]) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(line[1]);
  } catch {
    return null;
  }
  if (typeof meta !== "object" || meta === null) return null;
  const record = meta as Record<string, unknown>;
  const keys = ["states", "candidates", "captures", "unique", "captureMs"] as const;
  const values = keys.map((key) => record[key]);
  if (!values.every((value): value is number => typeof value === "number")) return null;
  const [states, candidates, captures, unique, captureMs] = values as [
    number,
    number,
    number,
    number,
    number,
  ];
  return { states, candidates, captures, unique, captureMs };
}

export function describeRenderPath(path: RenderPath): string {
  switch (path.kind) {
    case "passthrough":
      return "passthrough";
    case "ineligible":
      return `fallback: ineligible (${path.reason}${path.detail ? `: ${path.detail}` : ""})`;
    case "passthrough_error":
      return `fallback: passthrough threw${path.detail ? ` (${path.detail})` : ""}`;
    case "layered":
      return "layered";
    case "unknown":
      return "unknown (no HDR path markers in the log)";
  }
}

export function isFallback(path: RenderPath): boolean {
  return path.kind === "ineligible" || path.kind === "passthrough_error";
}

/**
 * A frame rate as the CLI takes it (`30`, `30000/1001`): the string passed to
 * `--fps` and its value. Decimals are rejected, as the CLI rejects them.
 */
export interface FrameRate {
  arg: string;
  value: number;
}

export function parseFrameRate(input: string | number): FrameRate {
  const raw = String(input).trim();
  const fraction = /^(\d+)\/(\d+)$/.exec(raw);
  const value = fraction
    ? Number(fraction[1]) / Number(fraction[2])
    : /^\d+$/.test(raw)
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`frame rate must be an integer or num/den, got ${JSON.stringify(input)}`);
  }
  return { arg: raw, value };
}

/**
 * Frames a render of `durationSec` writes: the nearest whole frame when the
 * duration is within 1 ms of one, else rounded up (the probe stage's rule, so a
 * 7.01 s composition at 30 fps has 211 frames).
 */
export function expectedFrameCount(durationSec: number, fps: number): number {
  const raw = durationSec * fps;
  const nearest = Math.round(raw);
  return Math.abs(raw - nearest) <= 1e-3 ? nearest : Math.ceil(raw);
}

/** Per-frame hashes from `ffmpeg -f framemd5` output, in frame order. */
export function parseFramemd5(output: string): string[] {
  const hashes: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line === "" || line.startsWith("#")) continue;
    const hash = line.split(",").at(-1)?.trim();
    if (!hash || !/^[0-9a-f]{32}$/.test(hash)) {
      throw new Error(`unexpected framemd5 line: ${JSON.stringify(line)}`);
    }
    hashes.push(hash);
  }
  return hashes;
}

/** How two outputs' decoded frames compare, frame by frame. */
export interface FrameHashComparison {
  referenceFrames: number;
  candidateFrames: number;
  identicalFrames: number;
  /** First frame index whose hash differs (or that one side lacks); null when all match. */
  firstDifference: number | null;
  /** Every frame matches and both have the same count. */
  identical: boolean;
}

export function compareFrameHashes(
  reference: readonly string[],
  candidate: readonly string[],
): FrameHashComparison {
  let identicalFrames = 0;
  let firstDifference: number | null = null;
  const frames = Math.max(reference.length, candidate.length);
  for (let index = 0; index < frames; index += 1) {
    if (reference[index] !== undefined && reference[index] === candidate[index]) {
      identicalFrames += 1;
    } else if (firstDifference === null) {
      firstDifference = index;
    }
  }
  return {
    referenceFrames: reference.length,
    candidateFrames: candidate.length,
    identicalFrames,
    firstDifference,
    identical: firstDifference === null,
  };
}

/**
 * The render job's own time, compile through assemble, from the
 * `[Render:trace]` lines: the `assemble` end checkpoint's `elapsedMs`. Wall
 * time also counts the CLI start and any wait on the per-user render lock,
 * which on a shared host can dwarf the render. Null when the log has no such
 * line.
 */
export function parseJobMs(log: string): number | null {
  let jobMs: number | null = null;
  for (const match of log.matchAll(/\[Render:trace\][ \t]+(\{.*\})[ \t]*$/gm)) {
    let trace: unknown;
    try {
      trace = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    if (typeof trace !== "object" || trace === null) continue;
    const { phase, status, elapsedMs } = trace as Record<string, unknown>;
    if (phase === "assemble" && status === "end" && typeof elapsedMs === "number") {
      jobMs = elapsedMs;
    }
  }
  return jobMs;
}

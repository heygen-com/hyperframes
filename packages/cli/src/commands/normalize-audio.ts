import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { formatAudioGain, MAX_AUDIO_GAIN_DB } from "@hyperframes/core/audio-gain";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { defineCommand } from "citty";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { failCommand } from "../utils/commandResult.js";
import type { Example } from "./_examples.js";

const execFileAsync = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 120_000;
const DEFAULT_TOLERANCE_LU = 0.5;

interface AttributeSpan {
  value: string;
  valueStart: number;
  valueEnd: number;
}

interface TagRange {
  start: number;
  end: number;
}

interface ParsedStartTag extends TagRange {
  closing: boolean;
  name: string;
}

interface ScanResult {
  cursor: number;
  audioRange: TagRange | null;
}

export interface AudioTag {
  id: string;
  src: string;
  volume: number;
  mediaStart: number;
  duration: number | null;
  start: number;
  end: number;
  volumeAttribute: AttributeSpan | null;
}

export interface LoudnessMeasurement {
  integratedLufs: number;
  truePeakDbfs: number;
}

export interface NormalizationTrack extends LoudnessMeasurement {
  id: string;
  volume: number;
}

export interface AudioNormalizationPlan {
  referenceId: string;
  targetId: string;
  referenceLufs: number;
  targetLufs: number;
  previousVolume: number;
  volume: number;
  gainDb: number;
  changeDb: number;
  projectedLufs: number;
  projectedTruePeakDbfs: number;
}

function authoredNumber(
  raw: string | undefined,
  fallback: number,
  attribute: string,
  id: string,
  strictlyPositive = false,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || (strictlyPositive ? value <= 0 : value < 0)) {
    throw new Error(`Audio #${id} has an invalid ${attribute}: ${raw}`);
  }
  return value;
}

function attributeFromMatch(
  match: RegExpMatchArray,
  absoluteOffset: number,
): [string, AttributeSpan] | null {
  if (match.index === undefined) return null;
  const name = match[1]?.toLowerCase();
  const value = matchedAttributeValue(match);
  if (!name || value === undefined) return null;

  const whole = match[0];
  const localValueStart = attributeValueStart(whole);
  const valueStart = absoluteOffset + match.index + localValueStart;
  return [name, { value, valueStart, valueEnd: valueStart + value.length }];
}

function matchedAttributeValue(match: RegExpMatchArray): string | undefined {
  return match[2] ?? match[3] ?? match[4];
}

function attributeValueStart(attribute: string): number {
  let cursor = attribute.indexOf("=") + 1;
  while (/\s/.test(attribute[cursor] ?? "")) cursor += 1;
  const quote = attribute[cursor];
  return quote === '"' || quote === "'" ? cursor + 1 : cursor;
}

function attributesInTag(html: string, from: number, to: number): Map<string, AttributeSpan> {
  const tag = html.slice(from, to);
  const nameEnd = tag.search(/\s|\/?\s*>/);
  const attributes = new Map<string, AttributeSpan>();
  if (nameEnd < 0) return attributes;

  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.slice(nameEnd).matchAll(pattern)) {
    const attribute = attributeFromMatch(match, from + nameEnd);
    if (attribute) attributes.set(...attribute);
  }
  return attributes;
}

function startTagEnd(html: string, start: number): number {
  let quote = "";
  let end = start + 1;
  for (; end < html.length; end += 1) {
    const char = html[end];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return end + 1;
    }
  }
  throw new Error("Unterminated HTML start tag");
}

function commentEnd(html: string, start: number): number {
  const end = html.indexOf("-->", start + 4);
  if (end < 0) throw new Error("Unterminated HTML comment");
  return end + 3;
}

function parsedStartTag(html: string, start: number): ParsedStartTag | null {
  const match = html.slice(start).match(/^<\s*(\/?)\s*([a-z][a-z\d:-]*)\b/i);
  if (!match) return null;
  return {
    start,
    end: startTagEnd(html, start),
    closing: match[1] === "/",
    name: match[2]?.toLowerCase() ?? "",
  };
}

function rawTextElementEnd(html: string, lower: string, tag: ParsedStartTag): number | null {
  if (tag.closing || (tag.name !== "script" && tag.name !== "style")) return null;
  const closeStart = lower.indexOf(`</${tag.name}`, tag.end);
  if (closeStart < 0) throw new Error(`Unterminated <${tag.name}> element`);
  return startTagEnd(html, closeStart);
}

function scanMarkup(html: string, lower: string, start: number): ScanResult {
  if (html.startsWith("<!--", start)) {
    return { cursor: commentEnd(html, start), audioRange: null };
  }
  const tag = parsedStartTag(html, start);
  if (!tag) {
    const marker = html[start + 1];
    const cursor = marker === "!" || marker === "?" ? startTagEnd(html, start) : start + 1;
    return { cursor, audioRange: null };
  }
  const rawTextEnd = rawTextElementEnd(html, lower, tag);
  if (rawTextEnd !== null) return { cursor: rawTextEnd, audioRange: null };
  const audioRange = !tag.closing && tag.name === "audio" ? { start, end: tag.end } : null;
  return { cursor: tag.end, audioRange };
}

function audioTagRanges(html: string): TagRange[] {
  const lower = html.toLowerCase();
  const ranges: TagRange[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    const scanned = scanMarkup(html, lower, start);
    if (scanned.audioRange) ranges.push(scanned.audioRange);
    cursor = scanned.cursor;
  }
  return ranges;
}

function trimmedAttribute(attributes: Map<string, AttributeSpan>, name: string): string {
  return attributes.get(name)?.value.trim() ?? "";
}

/**
 * How much of the source the composition actually plays.
 *
 * `data-duration` is the explicit trim; absent, `data-end` still bounds the
 * clip's timeline window, and the parser, the runtime and the render mixer all
 * honour it. Measuring the whole file for a `data-end`-trimmed clip reads a
 * loudness the composition never plays — and `--write` then "corrects" an
 * already-matched clip by tens of dB.
 */
function authoredDuration(attributes: Map<string, AttributeSpan>, id: string): number | null {
  const raw = attributes.get("data-duration")?.value;
  if (raw !== undefined) return authoredNumber(raw, 0, "data-duration", id, true);

  const rawEnd = attributes.get("data-end")?.value;
  if (rawEnd === undefined) return null;
  const end = authoredNumber(rawEnd, 0, "data-end", id, true);
  const start = authoredNumber(attributes.get("data-start")?.value, 0, "data-start", id);
  return end > start ? end - start : null;
}

function requiredAudioIdentity(attributes: Map<string, AttributeSpan>) {
  const id = trimmedAttribute(attributes, "id");
  const src = trimmedAttribute(attributes, "src");
  if (!id) throw new Error("Every normalized <audio> element needs an id");
  if (!src) throw new Error(`Audio #${id} has no src`);
  return { id, src };
}

function audioTagFromRange(html: string, range: TagRange): AudioTag {
  const attributes = attributesInTag(html, range.start, range.end);
  const { id, src } = requiredAudioIdentity(attributes);
  const volumeAttribute = attributes.get("data-volume") ?? null;
  return {
    id,
    src,
    volume: authoredNumber(volumeAttribute?.value, 1, "data-volume", id),
    mediaStart: authoredNumber(
      attributes.get("data-media-start")?.value,
      0,
      "data-media-start",
      id,
    ),
    duration: authoredDuration(attributes, id),
    start: range.start,
    end: range.end,
    volumeAttribute,
  };
}

/** Read the authored audio clips without reserializing the composition. */
export function audioTags(html: string): AudioTag[] {
  const seen = new Set<string>();
  const tags: AudioTag[] = [];
  for (const range of audioTagRanges(html)) {
    const tag = audioTagFromRange(html, range);
    if (seen.has(tag.id)) throw new Error(`Duplicate audio id "${tag.id}"`);
    seen.add(tag.id);
    tags.push(tag);
  }
  return tags;
}

/** Resolve only a file contained by the project. Remote and traversal sources are not measured. */
export function resolveLocalAudioPath(projectDir: string, src: string): string {
  const withoutSuffix = src.split(/[?#]/, 1)[0] ?? "";
  let decoded = "";
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    throw new Error(`Audio source must be a local project file: ${src}`);
  }
  if (!decoded || isAbsolute(decoded) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded)) {
    throw new Error(`Audio source must be a local project file: ${src}`);
  }
  const root = resolve(projectDir);
  const file = resolve(root, decoded);
  const rel = relative(root, file);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Audio source must be a local project file: ${src}`);
  }
  return file;
}

/** Parse FFmpeg's final EBU R128 summary, not its per-window log lines. */
export function parseEbur128Summary(stderr: string): LoudnessMeasurement {
  const summaryAt = stderr.lastIndexOf("Summary:");
  const summary = summaryAt >= 0 ? stderr.slice(summaryAt) : "";
  const integrated = summary.match(/\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS\b/);
  const peak = summary.match(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS\b/);
  const integratedLufs = Number(integrated?.[1]);
  const truePeakDbfs = Number(peak?.[1]);
  if (!Number.isFinite(integratedLufs)) {
    throw new Error("FFmpeg did not report integrated loudness for this audio stream");
  }
  if (!Number.isFinite(truePeakDbfs)) {
    throw new Error("FFmpeg did not report true peak for this audio stream");
  }
  return { integratedLufs, truePeakDbfs };
}

function gainDb(volume: number): number {
  return volume > 0 ? 20 * Math.log10(volume) : Number.NEGATIVE_INFINITY;
}

/** Calculate the target's absolute authored gain while keeping the reference unchanged. */
export function audioNormalizationPlan(
  referenceTrack: NormalizationTrack,
  targetTrack: NormalizationTrack,
): AudioNormalizationPlan {
  if (!(referenceTrack.volume > 0) || !(targetTrack.volume > 0)) {
    throw new Error("Muted audio cannot be used for loudness matching");
  }
  const referenceLufs = referenceTrack.integratedLufs + gainDb(referenceTrack.volume);
  const targetLufs = targetTrack.integratedLufs + gainDb(targetTrack.volume);
  const wantedGainDb = referenceLufs - targetTrack.integratedLufs;
  if (wantedGainDb > MAX_AUDIO_GAIN_DB + 1e-9) {
    throw new Error(
      `Matching #${targetTrack.id} needs ${wantedGainDb.toFixed(1)} dB, beyond the +${MAX_AUDIO_GAIN_DB} dB authoring ceiling. ` +
        `A gap this large belongs in the source file, not the mixer — mixer gain raises the noise floor with the signal. ` +
        `Normalize ${targetTrack.id}'s asset offline (e.g. ffmpeg loudnorm), or lower #${referenceTrack.id} instead.`,
    );
  }
  const volume = 10 ** (wantedGainDb / 20);
  const projectedTruePeakDbfs = targetTrack.truePeakDbfs + wantedGainDb;
  if (projectedTruePeakDbfs > 0) {
    throw new Error(
      `Matching #${targetTrack.id} would clip at +${projectedTruePeakDbfs.toFixed(1)} dBFS; limit or preprocess the source first`,
    );
  }
  return {
    referenceId: referenceTrack.id,
    targetId: targetTrack.id,
    referenceLufs,
    targetLufs,
    previousVolume: targetTrack.volume,
    volume,
    gainDb: wantedGainDb,
    changeDb: wantedGainDb - gainDb(targetTrack.volume),
    projectedLufs: targetTrack.integratedLufs + wantedGainDb,
    projectedTruePeakDbfs,
  };
}

/** Patch one authored attribute in place so scripts/styles/comments remain byte-stable. */
export function updateAudioVolume(html: string, id: string, volume: number): string {
  const tag = audioTags(html).find((candidate) => candidate.id === id);
  if (!tag) throw new Error(`Audio #${id} was not found`);
  const value = formatAudioGain(volume);
  if (tag.volumeAttribute) {
    return (
      html.slice(0, tag.volumeAttribute.valueStart) +
      value +
      html.slice(tag.volumeAttribute.valueEnd)
    );
  }

  let insertion = tag.end - 1;
  let tail = insertion - 1;
  while (tail >= tag.start && /\s/.test(html[tail] ?? "")) tail -= 1;
  if (html[tail] === "/") {
    insertion = tail;
    while (insertion > tag.start && /\s/.test(html[insertion - 1] ?? "")) insertion -= 1;
  } else {
    while (insertion > tag.start && /\s/.test(html[insertion - 1] ?? "")) insertion -= 1;
  }
  return html.slice(0, insertion) + ` data-volume="${value}"` + html.slice(insertion);
}

/**
 * FFmpeg arguments that measure exactly the window the composition plays.
 *
 * `-ss` / `-t` go BEFORE `-i`, as INPUT options. After `-i` they bound the
 * output, and with `-f null` there is no real output to bound: ffmpeg keeps
 * feeding the filter graph past the limit, so ebur128 integrates audio the clip
 * never plays. Measured on a 12 s file whose first 4 s — the played window — is
 * -61.8 LUFS: output-side `-t 4` reported -33.8 LUFS, input-side reports -61.8,
 * the same as physically cutting the file first.
 */
export function loudnessMeasureArgs(
  file: string,
  tag: Pick<AudioTag, "mediaStart" | "duration">,
): string[] {
  const args = ["-hide_banner", "-nostats"];
  if (tag.mediaStart > 0) args.push("-ss", String(tag.mediaStart));
  if (tag.duration !== null && tag.duration > 0) args.push("-t", String(tag.duration));
  args.push("-i", file, "-map", "0:a:0", "-vn", "-af", "ebur128=peak=true", "-f", "null", "-");
  return args;
}

async function measureAudio(
  ffmpegPath: string,
  file: string,
  tag: Pick<AudioTag, "mediaStart" | "duration">,
): Promise<LoudnessMeasurement> {
  const result = await execFileAsync(ffmpegPath, loudnessMeasureArgs(file, tag), {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: FFMPEG_TIMEOUT_MS,
  });
  return parseEbur128Summary(result.stderr);
}

/**
 * Under `--json` every outcome has to be one parseable document, including the
 * failures — this command exists to be driven by an agent, and an agent doing
 * `JSON.parse(stdout)` on a bare error line just throws.
 */
function fail(message: string, json: boolean): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(c.error(message));
  failCommand();
}

function byId(tags: readonly AudioTag[], rawId: string, role: string): AudioTag {
  const id = rawId.trim().replace(/^#/, "");
  const tag = tags.find((candidate) => candidate.id === id);
  if (!tag) throw new Error(`${role} audio #${id} was not found`);
  return tag;
}

interface NormalizeAudioOptions {
  dir?: string;
  reference: string;
  target: string;
  tolerance: string;
  write: boolean;
}

interface NormalizeAudioResult extends AudioNormalizationPlan {
  ok: true;
  wrote: boolean;
  withinTolerance: boolean;
  tolerance: number;
  indexPath: string;
}

function selectedTags(html: string, referenceId: string, targetId: string) {
  const tags = audioTags(html);
  const referenceTag = byId(tags, referenceId, "Reference");
  const targetTag = byId(tags, targetId, "Target");
  if (referenceTag.id === targetTag.id) {
    throw new Error("Reference and target must be different audio elements");
  }
  return { referenceTag, targetTag };
}

function requiredFfmpeg(): string {
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) throw new Error("FFmpeg is required to measure integrated loudness");
  return ffmpegPath;
}

function existingAudioFile(projectDir: string, tag: AudioTag): string {
  const file = resolveLocalAudioPath(projectDir, tag.src);
  if (!existsSync(file)) {
    throw new Error(`Audio #${tag.id} file was not found: ${relative(projectDir, file)}`);
  }
  return file;
}

async function measuredPlan(
  projectDir: string,
  referenceTag: AudioTag,
  targetTag: AudioTag,
): Promise<AudioNormalizationPlan> {
  const ffmpegPath = requiredFfmpeg();
  const referenceFile = existingAudioFile(projectDir, referenceTag);
  const targetFile = existingAudioFile(projectDir, targetTag);
  const [referenceMeasurement, targetMeasurement] = await Promise.all([
    measureAudio(ffmpegPath, referenceFile, referenceTag),
    measureAudio(ffmpegPath, targetFile, targetTag),
  ]);
  return audioNormalizationPlan(
    { id: referenceTag.id, volume: referenceTag.volume, ...referenceMeasurement },
    { id: targetTag.id, volume: targetTag.volume, ...targetMeasurement },
  );
}

/** Never leave a half-written composition behind if the process dies mid-write. */
function writeAtomically(path: string, contents: string): void {
  const temporary = `${path}.hf-normalize-${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function parsedTolerance(raw: string): number {
  const tolerance = Number(raw);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("--tolerance must be a non-negative number");
  }
  return tolerance;
}

async function normalizeAudio(options: NormalizeAudioOptions): Promise<NormalizeAudioResult> {
  const project = resolveProject(options.dir);
  const html = readFileSync(project.indexPath, "utf8");
  const { referenceTag, targetTag } = selectedTags(html, options.reference, options.target);
  // Before the measurement, not after: each EBU R128 pass is bounded at 120s, so
  // validating this afterwards made a typo'd --tolerance cost two of them before
  // failing on an argument that was wrong the whole time.
  const tolerance = parsedTolerance(options.tolerance);
  const plan = await measuredPlan(project.dir, referenceTag, targetTag);
  const withinTolerance = Math.abs(plan.referenceLufs - plan.targetLufs) <= tolerance;
  const wrote = options.write && !withinTolerance;
  // Re-read: two EBU R128 passes ran since the snapshot above, each bounded
  // only by FFMPEG_TIMEOUT_MS, and the skill tells agents to keep Studio open
  // on the project while normalizing. Serializing the stale snapshot would
  // silently revert every edit made during that window. The write is one
  // attribute patch, so re-applying it to the current file is the same edit.
  if (wrote) {
    writeAtomically(
      project.indexPath,
      updateAudioVolume(readFileSync(project.indexPath, "utf8"), targetTag.id, plan.volume),
    );
  }
  return { ok: true, wrote, withinTolerance, tolerance, indexPath: project.indexPath, ...plan };
}

function printHumanResult(result: NormalizeAudioResult): void {
  console.log(
    `${c.bold(`#${result.referenceId}`)} ${result.referenceLufs.toFixed(1)} LUFS → ` +
      `${c.bold(`#${result.targetId}`)} ${result.targetLufs.toFixed(1)} LUFS`,
  );
  if (result.withinTolerance) {
    console.log(
      c.success(`Already matched within ${result.tolerance.toFixed(1)} LU; no change needed.`),
    );
    return;
  }

  console.log(
    `Set #${result.targetId} data-volume ${result.previousVolume.toFixed(3)} → ${result.volume.toFixed(6)} ` +
      `(${result.changeDb >= 0 ? "+" : ""}${result.changeDb.toFixed(1)} dB).`,
  );
  console.log(
    result.wrote
      ? c.success(`Updated ${relative(process.cwd(), result.indexPath) || "index.html"}.`)
      : c.dim("Dry run only. Pass --write to persist this gain."),
  );
}

export const examples: Example[] = [
  [
    "Measure two authored clips and preview the matching gain",
    "hyperframes normalize-audio --reference target-audio --target user-audio",
  ],
  [
    "Persist the measured gain into index.html",
    "hyperframes normalize-audio --reference target-audio --target user-audio --write",
  ],
];

export default defineCommand({
  meta: {
    name: "normalize-audio",
    description: "Match one local audio clip to another using integrated LUFS",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    reference: {
      type: "string",
      description: "Audio element id whose effective loudness should be preserved",
      required: true,
    },
    target: {
      type: "string",
      description: "Audio element id whose data-volume should be matched",
      required: true,
    },
    write: {
      type: "boolean",
      description: "Persist the measured target gain into index.html",
      default: false,
    },
    tolerance: {
      type: "string",
      description: `Skip writes within this many LU (default ${DEFAULT_TOLERANCE_LU})`,
      default: String(DEFAULT_TOLERANCE_LU),
    },
    json: { type: "boolean", description: "Print machine-readable output", default: false },
  },
  async run({ args }) {
    try {
      const result = await normalizeAudio({
        dir: args.dir,
        reference: args.reference,
        target: args.target,
        tolerance: args.tolerance,
        write: args.write,
      });
      if (args.json) {
        const { indexPath: _, ...jsonResult } = result;
        console.log(JSON.stringify(jsonResult, null, 2));
        return;
      }
      printHumanResult(result);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), Boolean(args.json));
    }
  },
});

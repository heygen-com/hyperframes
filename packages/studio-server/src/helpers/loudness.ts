import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { isAudibleVideoElement } from "@hyperframes/core/audible-video";
import { formatAudioGain, MAX_AUDIO_GAIN_DB } from "@hyperframes/core/audio-gain";
import { decodeAuthoredAttribute } from "@hyperframes/parsers";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { requestedProjectPath } from "./requestSubPath.js";

const execFileAsync = promisify(execFile);

const FFMPEG_TIMEOUT_MS = 120_000;

interface AttributeSpan {
  value: string;
  valueStart: number;
  valueEnd: number;
}

interface TagRange {
  start: number;
  end: number;
}

type MediaTagName = "audio" | "video";

interface MediaTagRange extends TagRange {
  name: MediaTagName;
}

interface ParsedStartTag extends TagRange {
  closing: boolean;
  name: string;
}

interface ScanResult {
  cursor: number;
  mediaRange: MediaTagRange | null;
}

export interface AudioTag {
  tag: MediaTagName;
  id: string;
  src: string;
  volume: number;
  mediaStart: number;
  duration: number | null;
  playbackRate: number;
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
  return [
    name,
    {
      value: decodeAuthoredAttribute(value),
      valueStart,
      valueEnd: valueStart + value.length,
    },
  ];
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

const isSpaceAt = (html: string, index: number) => /\s/.test(html.charAt(index));
const isWordAt = (html: string, index: number) => /\w/.test(html.charAt(index));

function skipSpaces(html: string, index: number): number {
  let cursor = index;
  while (cursor < html.length && isSpaceAt(html, cursor)) cursor++;
  return cursor;
}

function parsedStartTag(html: string, start: number): ParsedStartTag | null {
  let cursor = skipSpaces(html, start + 1);
  const closing = html.charAt(cursor) === "/";
  if (closing) cursor = skipSpaces(html, cursor + 1);
  const nameStart = cursor;
  if (!/[a-z]/i.test(html.charAt(cursor))) return null;
  while (/[a-z\d:-]/i.test(html.charAt(cursor + 1))) cursor++;
  let nameEnd = cursor + 1;
  while (nameEnd > nameStart && isWordAt(html, nameEnd - 1) === isWordAt(html, nameEnd)) nameEnd--;
  if (nameEnd === nameStart) return null;
  return {
    start,
    end: startTagEnd(html, start),
    closing,
    name: html.slice(nameStart, nameEnd).toLowerCase(),
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
    return { cursor: commentEnd(html, start), mediaRange: null };
  }
  const tag = parsedStartTag(html, start);
  if (!tag) {
    const marker = html[start + 1];
    const cursor = marker === "!" || marker === "?" ? startTagEnd(html, start) : start + 1;
    return { cursor, mediaRange: null };
  }
  const rawTextEnd = rawTextElementEnd(html, lower, tag);
  if (rawTextEnd !== null) return { cursor: rawTextEnd, mediaRange: null };
  return { cursor: tag.end, mediaRange: mediaRangeOf(tag) };
}

function mediaRangeOf(tag: ParsedStartTag): MediaTagRange | null {
  if (tag.closing) return null;
  if (tag.name === "audio" || tag.name === "video") {
    return { start: tag.start, end: tag.end, name: tag.name };
  }
  return null;
}

function mediaTagRanges(html: string): MediaTagRange[] {
  const lower = html.toLowerCase();
  const ranges: MediaTagRange[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    const scanned = scanMarkup(html, lower, start);
    if (scanned.mediaRange) ranges.push(scanned.mediaRange);
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

/** Boolean attributes carry no `=`, so the value map cannot see them. */
function hasBareAttribute(html: string, range: TagRange, name: string): boolean {
  const unquoted = html.slice(range.start, range.end).replace(/"[^"]*"|'[^']*'/g, '""');
  return new RegExp(`\\s${name}(?=[\\s/>=])`, "i").test(unquoted);
}

function isAudibleVideoTag(
  html: string,
  range: TagRange,
  attributes: Map<string, AttributeSpan>,
): boolean {
  return isAudibleVideoElement({
    tagName: "video",
    hasAttribute: (name) => attributes.has(name) || hasBareAttribute(html, range, name),
    getAttribute: (name) => attributes.get(name)?.value ?? null,
  });
}

/**
 * A video joins the scan only when it carries sound and can be addressed.
 * Silent footage, and a video no command could name, are skipped rather than
 * failing a run that is about some other clip.
 */
function inScopeVideo(
  html: string,
  range: TagRange,
  attributes: Map<string, AttributeSpan>,
): boolean {
  return (
    isAudibleVideoTag(html, range, attributes) &&
    trimmedAttribute(attributes, "id") !== "" &&
    trimmedAttribute(attributes, "src") !== ""
  );
}

function mediaTagFromRange(html: string, range: MediaTagRange): AudioTag | null {
  const attributes = attributesInTag(html, range.start, range.end);
  if (range.name === "video" && !inScopeVideo(html, range, attributes)) return null;
  const { id, src } = requiredAudioIdentity(attributes);
  const volumeAttribute = attributes.get("data-volume") ?? null;
  return {
    tag: range.name,
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
    playbackRate: authoredNumber(
      attributes.get("data-playback-rate")?.value,
      1,
      "data-playback-rate",
      id,
      true,
    ),
    start: range.start,
    end: range.end,
    volumeAttribute,
  };
}

/** Read the authored clips with sound — `<audio>` and audible `<video>` — without reserializing. */
export function audioTags(html: string): AudioTag[] {
  const seen = new Set<string>();
  const tags: AudioTag[] = [];
  for (const range of mediaTagRanges(html)) {
    const tag = mediaTagFromRange(html, range);
    if (!tag) continue;
    if (seen.has(tag.id)) throw new Error(`Duplicate audio id "${tag.id}"`);
    seen.add(tag.id);
    tags.push(tag);
  }
  return tags;
}

/** Resolve only a file contained by the project. Remote and traversal sources are not measured. */
export function resolveLocalAudioPath(projectDir: string, src: string): string {
  const decoded = requestedProjectPath(projectDir, src);
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

export function gainDb(volume: number): number {
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
export function loudnessMeasureArgs(file: string, tag: MeasuredWindow): string[] {
  const args = ["-hide_banner", "-nostats"];
  if (tag.mediaStart > 0) args.push("-ss", String(tag.mediaStart));
  const sourceSpan = tag.duration === null ? null : tag.duration * (tag.playbackRate ?? 1);
  if (sourceSpan !== null && sourceSpan > 0) args.push("-t", String(sourceSpan));
  args.push("-i", file, "-map", "0:a:0", "-vn", "-af", "ebur128=peak=true", "-f", "null", "-");
  return args;
}

export type MeasuredWindow = Pick<AudioTag, "mediaStart" | "duration"> &
  Partial<Pick<AudioTag, "playbackRate">>;

export async function measureAudio(
  ffmpegPath: string,
  file: string,
  tag: MeasuredWindow,
): Promise<LoudnessMeasurement> {
  const result = await execFileAsync(ffmpegPath, loudnessMeasureArgs(file, tag), {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: FFMPEG_TIMEOUT_MS,
    windowsHide: true,
  });
  return parseEbur128Summary(result.stderr);
}

export function requiredFfmpeg(): string {
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) throw new Error("FFmpeg is required to measure integrated loudness");
  return ffmpegPath;
}

export const DEFAULT_TARGET_LUFS = -16;
export const NORMALIZE_TRUE_PEAK_CEILING_DBFS = -1.5;
/** EBU R128's absolute gate: a window this quiet has no integrated loudness to match. */
const SILENCE_LUFS = -70;

export type LoudnessLimit = "gain-ceiling" | "true-peak";

export interface AbsoluteLoudnessPlan {
  targetId: string;
  targetLufs: number;
  sourceLufs: number;
  previousVolume: number;
  volume: number;
  gainDb: number;
  changeDb: number;
  projectedLufs: number;
  projectedTruePeakDbfs: number;
  limitedBy: LoudnessLimit | null;
}

/**
 * The authored gain that brings one clip's played window to an absolute
 * loudness. Unlike reference matching it never refuses: past the +12 dB
 * authoring ceiling or the true-peak ceiling it applies the most that fits and
 * names which limit stopped it.
 */
export function absoluteLoudnessPlan(
  track: NormalizationTrack,
  targetLufs: number = DEFAULT_TARGET_LUFS,
): AbsoluteLoudnessPlan {
  if (track.integratedLufs <= SILENCE_LUFS) {
    throw new Error(`#${track.id} is silent in the played window; there is nothing to normalize`);
  }
  const wantedGainDb = targetLufs - track.integratedLufs;
  const peakRoomDb = NORMALIZE_TRUE_PEAK_CEILING_DBFS - track.truePeakDbfs;
  const limits: Array<[LoudnessLimit | null, number]> = [
    [null, wantedGainDb],
    ["gain-ceiling", MAX_AUDIO_GAIN_DB],
    ["true-peak", peakRoomDb],
  ];
  const [limitedBy, appliedGainDb] = limits.reduce((lowest, candidate) =>
    candidate[1] < lowest[1] - 1e-9 ? candidate : lowest,
  );
  const previousGainDb = track.volume > 0 ? gainDb(track.volume) : 0;
  return {
    targetId: track.id,
    targetLufs,
    sourceLufs: track.integratedLufs,
    previousVolume: track.volume,
    volume: 10 ** (appliedGainDb / 20),
    gainDb: appliedGainDb,
    changeDb: appliedGainDb - previousGainDb,
    projectedLufs: track.integratedLufs + appliedGainDb,
    projectedTruePeakDbfs: track.truePeakDbfs + appliedGainDb,
    limitedBy,
  };
}

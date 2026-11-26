import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  locateCaptionArrays,
  pickCaptionArray,
  type CaptionArrayWord,
} from "@hyperframes/parsers/caption-array";
import {
  AUDIO_META_FILE,
  NARRATION_FILE,
  NARRATION_LINE_ATTR,
  narrationComparableWords,
  narrationVoiceKey,
  normalizeNarrationText,
  narrationTimingsOf,
  parseNarrationManifest,
  type NarrationLine,
  type NarrationManifest,
  type NarrationTiming,
} from "@hyperframes/parsers/narration";
import type { HyperframeLintFinding } from "./types";

/** A clip's length may differ from its line's by this much before it counts as drift. */
const DURATION_EPS = 0.05;
/** A caption word may start this far from where its line's voice says it before it counts as drift. */
const CAPTION_EPS = 0.1;

interface HtmlSource {
  html: string;
  compSrcPath?: string;
}

/** An audible clip on the main timeline, in global seconds. */
export interface NarrationClip {
  start: number;
  end: number;
  src: string;
  narrationLine?: string;
}

interface CaptionWord extends CaptionArrayWord {
  /** Global seconds: the composition's origin plus the word's own start. */
  at: number;
}

export const narrationTextHash = (text: string) =>
  createHash("sha256").update(normalizeNarrationText(text)).digest("hex");

const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const seconds = (t: number) => (Number.isFinite(t) ? `${Number(t.toFixed(2))}s` : "no end");

const finding = (
  code: string,
  severity: HyperframeLintFinding["severity"],
  message: string,
  fixHint: string,
): HyperframeLintFinding => ({ code, severity, message, fixHint, file: NARRATION_FILE });

const SET_FIX =
  "Re-voice the line (with media-use, `--only tts` and just this line in the request) and re-time its caption words, then update the line's `voiced` record.";

function staleReasons(projectDir: string, manifest: NarrationManifest, line: NarrationLine) {
  const reasons: string[] = [];
  const audio = resolve(projectDir, line.audio);
  const exists = existsSync(audio);
  if (!exists) reasons.push(`its audio file ${line.audio} is missing`);
  const { voiced } = line;
  if (!voiced) return [...reasons, "it has no record of what it was voiced from"];
  if (voiced.textHash !== narrationTextHash(line.text)) reasons.push("its text changed");
  if (voiced.voiceKey !== narrationVoiceKey(line, manifest.defaults)) {
    reasons.push("its voice settings changed");
  }
  if (exists && voiced.audioHash !== fileHash(audio)) reasons.push("its WAV was replaced");
  return reasons;
}

function captionWordsOf(
  sources: ReadonlyArray<HtmlSource>,
  manifest: NarrationManifest,
  originOf: (compSrcPath: string | undefined) => number | null,
): CaptionWord[] | null {
  const wanted = manifest.captions?.file?.replace(/\\/g, "/");
  for (const source of sources) {
    const file = source.compSrcPath ?? "index.html";
    if (wanted && file !== wanted) continue;
    const array = pickCaptionArray(locateCaptionArrays(source.html), manifest.captions?.array);
    const origin = array ? originOf(source.compSrcPath) : null;
    if (!array || origin === null) continue;
    return array.words.map((word) => ({ ...word, at: origin + word.startTime }));
  }
  return null;
}

/** The caption words that show a line: those tagged with it, else untagged words inside its clip. */
function wordsShowing(words: CaptionWord[], line: NarrationLine, clip: NarrationClip) {
  const tagged = words.filter((word) => word.line === line.id);
  if (tagged.length > 0) return tagged;
  return words.filter(
    (word) => !word.line && word.at >= clip.start - CAPTION_EPS && word.at < clip.end,
  );
}

/**
 * Why a line's captions are out of sync, or null. With the voice's words (from audio_meta.json),
 * each caption word must start where the voice says it; without them, inside the line's clip.
 */
function syncProblem(shown: CaptionWord[], clip: NarrationClip, timing?: NarrationTiming) {
  if (!timing) {
    const outside = shown.find(
      (word) => word.at < clip.start - CAPTION_EPS || word.at >= clip.end + CAPTION_EPS,
    );
    return outside
      ? `caption word "${outside.text}" starts at ${seconds(outside.at)}, outside its clip (${seconds(clip.start)} to ${seconds(clip.end)})`
      : null;
  }
  const expected = timing.words.map((word) => clip.start + word.start);
  if (shown.length !== expected.length) {
    return `${shown.length} caption words show it, but its voice has ${expected.length}`;
  }
  const drift = shown.findIndex(
    (word, index) => Math.abs(word.at - expected[index]!) > CAPTION_EPS,
  );
  return drift < 0
    ? null
    : `caption word "${shown[drift]!.text}" starts at ${seconds(shown[drift]!.at)}, but the voice says it at ${seconds(expected[drift]!)}`;
}

function captionFindings(
  line: NarrationLine,
  clip: NarrationClip,
  words: CaptionWord[],
  timing?: NarrationTiming,
) {
  const shown = wordsShowing(words, line, clip);
  const detail = syncProblem(shown, clip, timing);
  if (detail) {
    return [
      finding(
        "narration_captions_out_of_sync",
        "warning",
        `Narration line ${line.id}: ${detail}.`,
        SET_FIX,
      ),
    ];
  }
  const said = narrationComparableWords(line.text).join(" ");
  const showing = narrationComparableWords(shown.map((word) => word.text).join(" ")).join(" ");
  if (said === showing) return [];
  return [
    finding(
      "narration_transcript_mismatch",
      "info",
      `Narration line ${line.id} says "${line.text}", but its captions read "${shown.map((word) => word.text).join(" ")}".`,
      "Usually harmless (a transcriber writes 47 for forty-seven). If the captions should match the script, edit the caption words.",
    ),
  ];
}

const samePath = (a: string, b: string) =>
  a.replace(/\\/g, "/").replace(/^\.\//, "") === b.replace(/\\/g, "/").replace(/^\.\//, "");

/** The line's generated voice from audio_meta.json, if it describes the line's own audio file. */
function timingOf(line: NarrationLine, timings: Map<string, NarrationTiming> | null) {
  const timing = timings?.get(line.id);
  if (!timing || (timing.path !== undefined && !samePath(timing.path, line.audio)))
    return undefined;
  return timing;
}

function lineFindings(
  projectDir: string,
  manifest: NarrationManifest,
  line: NarrationLine,
  clips: NarrationClip[],
  captions: CaptionWord[] | null,
  timings: Map<string, NarrationTiming> | null,
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  const stale = staleReasons(projectDir, manifest, line);
  if (stale.length > 0) {
    findings.push(
      finding(
        "narration_audio_stale",
        "warning",
        `Narration line ${line.id} needs re-voicing: ${stale.join(", ")}.`,
        SET_FIX,
      ),
    );
  }
  if (clips.length !== 1) {
    const message =
      clips.length === 0
        ? `Narration line ${line.id} has no <audio ${NARRATION_LINE_ATTR}="${line.id}"> on the timeline.`
        : `Narration line ${line.id} is linked from ${clips.length} clips; link it from one.`;
    return [
      ...findings,
      finding(
        "narration_line_unlinked",
        "warning",
        message,
        `Add ${NARRATION_LINE_ATTR}="${line.id}" to the one <audio> element that plays ${line.audio}.`,
      ),
    ];
  }
  const clip = clips[0]!;
  const length = clip.end - clip.start;
  const timing = timingOf(line, timings);
  if (timing && !(Math.abs(length - timing.durationSeconds) <= DURATION_EPS)) {
    findings.push(
      finding(
        "narration_clip_timing_mismatch",
        "warning",
        `Narration line ${line.id} lasts ${seconds(timing.durationSeconds)}, but its clip plays for ${seconds(length)}.`,
        `Set the clip's data-duration to ${timing.durationSeconds}, the length audio_meta.json records for the line.`,
      ),
    );
  }
  if (captions) findings.push(...captionFindings(line, clip, captions, timing));
  return findings;
}

/** Each line's generated voice from audio_meta.json, or null when the project has none. */
function readTimings(projectDir: string) {
  const path = join(projectDir, AUDIO_META_FILE);
  return existsSync(path) ? narrationTimingsOf(readFileSync(path, "utf8")) : null;
}

/**
 * Drift between narration.json and the project: a line whose text, voice or WAV changed since it
 * was voiced, a clip that is missing or the wrong length, captions that no longer match the voice.
 * Lengths and word timings come from audio_meta.json; without it, the length isn't checked and a
 * line's captions only need to fall inside its clip. Warnings and infos only, so drift never
 * blocks a render. No manifest, no findings.
 */
export function lintProjectNarration(
  projectDir: string,
  sources: ReadonlyArray<HtmlSource>,
  clips: ReadonlyArray<NarrationClip>,
  originOf: (compSrcPath: string | undefined) => number | null,
): HyperframeLintFinding[] {
  const manifestPath = join(projectDir, NARRATION_FILE);
  if (!existsSync(manifestPath)) return [];
  const parsed = parseNarrationManifest(readFileSync(manifestPath, "utf8"));
  if (!parsed.ok) {
    return [
      finding(
        "narration_manifest_invalid",
        "warning",
        `${NARRATION_FILE} is not a narration manifest: ${parsed.problems.slice(0, 5).join("; ")}${parsed.problems.length > 5 ? ` (and ${parsed.problems.length - 5} more)` : ""}.`,
        "Fix the listed fields, or recreate the file with `hyperframes narration init`.",
      ),
    ];
  }
  const { manifest } = parsed;
  const known = new Set(manifest.lines.map((line) => line.id));
  const orphans = clips.filter((clip) => clip.narrationLine && !known.has(clip.narrationLine));
  const captions = captionWordsOf(sources, manifest, originOf);
  const timings = readTimings(projectDir);
  return [
    ...orphans.map((clip) =>
      finding(
        "narration_line_unlinked",
        "warning",
        `${clip.src} is linked to narration line "${clip.narrationLine}", which ${NARRATION_FILE} does not list.`,
        `Add the line to ${NARRATION_FILE}, or remove ${NARRATION_LINE_ATTR} from the clip.`,
      ),
    ),
    ...manifest.lines.flatMap((line) =>
      lineFindings(
        projectDir,
        manifest,
        line,
        clips.filter((clip) => clip.narrationLine === line.id),
        captions,
        timings,
      ),
    ),
  ];
}

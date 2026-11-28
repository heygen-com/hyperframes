import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  locateCaptionArrays,
  pickCaptionArray,
  spliceCaptionWords,
  type CaptionArrayLocation,
  type CaptionWordInput,
} from "@hyperframes/parsers/caption-array";
import {
  AUDIO_META_FILE,
  NARRATION_FILE,
  findNarrationLine,
  narrationVoiceKey,
  serializeNarrationManifest,
  type NarrationLine,
  type NarrationManifest,
  type NarrationVoiceSettings,
  type NarrationWord,
} from "@hyperframes/parsers/narration";
import { narrationTextHash } from "@hyperframes/lint";
import {
  CAPTION_OVERRIDES_FILE,
  NarrationRefusal,
  audioTags,
  compositionOrigin,
  findCaptions,
  projectHtmlFiles,
  readText,
  round3,
  setAttributes,
  type AudioTag,
} from "./project.js";

/** A fresh voicing of one line: the audio it was written to and the words heard in it. */
export interface NarrationTake {
  text: string;
  /** Voice settings the line now carries on top of the manifest defaults. */
  voice: NarrationVoiceSettings;
  /** Project-relative path the audio will be copied to. */
  audio: string;
  audioHash: string;
  durationSeconds: number;
  /** Seconds from the start of the clip. */
  words: NarrationWord[];
}

export interface NarrationSetPlan {
  line: string;
  /** Existing files to rewrite, in the order they were planned. */
  files: Array<{ file: string; before: string; after: string }>;
  /** Caption words replaced, and how many replaced them. */
  captions: { file: string; removed: number; added: number } | null;
  /** caption-overrides.json entries dropped because their word no longer exists. */
  overridesDropped: number;
  warnings: string[];
}

interface Working {
  texts: Map<string, string>;
  originals: Map<string, string>;
  warnings: string[];
}

function textOf(work: Working, projectDir: string, file: string): string {
  if (!work.texts.has(file)) {
    const text = readText(projectDir, file);
    work.texts.set(file, text);
    work.originals.set(file, text);
  }
  return work.texts.get(file)!;
}

function linkedClip(projectDir: string, lineId: string, work: Working): AudioTag {
  const clips = projectHtmlFiles(projectDir).flatMap((file) =>
    audioTags(file, textOf(work, projectDir, file)).filter((clip) => clip.line === lineId),
  );
  if (clips.length !== 1) {
    throw new NarrationRefusal(
      clips.length === 0
        ? `No <audio data-narration-line="${lineId}"> in the project; link the line's clip first`
        : `Line ${lineId} is linked from ${clips.length} clips; link it from one`,
    );
  }
  return clips[0]!;
}

/** A later narration clip on the same track that the longer take would run into. */
function overlapOf(projectDir: string, clip: AudioTag, duration: number, work: Working) {
  const end = clip.start + duration;
  return audioTags(clip.file, textOf(work, projectDir, clip.file)).find(
    (other) =>
      other.line !== undefined &&
      other.line !== clip.line &&
      other.track === clip.track &&
      other.start > clip.start &&
      other.start < end - 0.001,
  );
}

function checkOverlap(
  projectDir: string,
  clip: AudioTag,
  take: NarrationTake,
  allowOverlap: boolean,
  work: Working,
) {
  const next = overlapOf(projectDir, clip, take.durationSeconds, work);
  if (!next) return;
  const message = `The new take (${round3(take.durationSeconds)}s) runs into line ${next.line}, which starts at ${next.start}s on the same track`;
  if (!allowOverlap) {
    throw new NarrationRefusal(
      `${message}. Shorten the line, move line ${next.line}, or pass --no-retime to accept the overlap`,
    );
  }
  work.warnings.push(`${message}; kept because of --no-retime.`);
}

/** Indices of the caption words that show the line: tagged ones, else untagged words in its old clip. */
function shownIndices(
  array: CaptionArrayLocation,
  line: NarrationLine,
  from: number,
  length: number,
) {
  const tagged = array.words.flatMap((word, index) => (word.line === line.id ? [index] : []));
  const indices =
    tagged.length > 0
      ? tagged
      : array.words.flatMap((word, index) =>
          !word.line && word.startTime >= from - 0.1 && word.startTime < from + length
            ? [index]
            : [],
        );
  const contiguous = indices.every((index, i) => i === 0 || index === indices[i - 1]! + 1);
  if (!contiguous) {
    throw new NarrationRefusal(`Line ${line.id}'s caption words are not next to each other`);
  }
  return indices;
}

function newCaptionWords(take: NarrationTake, lineId: string, start: number): CaptionWordInput[] {
  return take.words.map((word, index) => ({
    id: `${lineId}w${index}`,
    text: word.text,
    start: round3(start + word.start),
    end: round3(start + word.end),
    line: lineId,
  }));
}

interface CaptionEdit {
  file: string;
  index: number;
  removed: string[];
  added: CaptionWordInput[];
}

function planCaptions(
  projectDir: string,
  manifest: NarrationManifest,
  line: NarrationLine,
  clip: AudioTag,
  take: NarrationTake,
  work: Working,
): CaptionEdit | null {
  const target = findCaptions(projectDir, manifest.captions);
  if (!target) return null;
  const html = textOf(work, projectDir, target.file);
  const array = pickCaptionArray(locateCaptionArrays(html), target.array.name)!;
  // Caption times are local to the file holding them.
  const clipStart = compositionOrigin(projectDir, clip.file) + clip.start - target.origin;
  const indices = shownIndices(array, line, clipStart, clip.duration);
  const index = indices[0] ?? array.words.findIndex((word) => word.startTime >= clipStart);
  const at = index < 0 ? array.words.length : index;
  const added = newCaptionWords(take, line.id, clipStart);
  work.texts.set(target.file, spliceCaptionWords(html, array, at, indices.length, added));
  const removed = indices.map((i) => array.words[i]!.id ?? "");
  return { file: target.file, index: at, removed, added };
}

type Override = Record<string, unknown> & { wordIndex?: number; wordId?: string };

/** Moves word indices after the edit, keeps a replaced word's overrides only when the count is unchanged. */
function remapOverride(override: Override, edit: CaptionEdit): Override | null {
  const count = edit.removed.length;
  const same = count === edit.added.length;
  const { wordIndex, wordId } = override;
  if (typeof wordId === "string" && edit.removed.includes(wordId)) {
    if (!same) return null;
    return { ...override, wordId: String(edit.added[edit.removed.indexOf(wordId)]!.id) };
  }
  if (typeof wordIndex !== "number" || wordIndex < edit.index) return override;
  if (wordIndex >= edit.index + count) {
    return { ...override, wordIndex: wordIndex + edit.added.length - count };
  }
  return same ? override : null;
}

function planOverrides(projectDir: string, edit: CaptionEdit, work: Working): number {
  if (!existsSync(join(projectDir, CAPTION_OVERRIDES_FILE))) return 0;
  const before = textOf(work, projectDir, CAPTION_OVERRIDES_FILE);
  let overrides: Override[];
  try {
    overrides = JSON.parse(before) as Override[];
  } catch {
    throw new NarrationRefusal(`${CAPTION_OVERRIDES_FILE} is not valid JSON; fix it first`);
  }
  if (!Array.isArray(overrides)) return 0;
  const kept = overrides.map((override) => remapOverride(override, edit));
  const remapped = kept.filter((override): override is Override => override !== null);
  if (JSON.stringify(remapped) !== JSON.stringify(overrides)) {
    work.texts.set(CAPTION_OVERRIDES_FILE, `${JSON.stringify(remapped, null, 2)}\n`);
  }
  return overrides.length - remapped.length;
}

type Json = Record<string, unknown>;

/**
 * audio_meta.json with the line's voice entry set to the new take (its other fields kept, or a new
 * entry appended), and total_duration_s summed again, written as media-use writes it. Nothing when
 * the project has no audio_meta.json: then there is no record of generated voices to keep current.
 */
function updatedAudioMeta(projectDir: string, lineId: string, take: NarrationTake, work: Working) {
  if (!existsSync(join(projectDir, AUDIO_META_FILE))) return;
  let meta: Json;
  try {
    meta = JSON.parse(textOf(work, projectDir, AUDIO_META_FILE)) as Json;
  } catch {
    throw new NarrationRefusal(`${AUDIO_META_FILE} is not valid JSON; fix it first`);
  }
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new NarrationRefusal(`${AUDIO_META_FILE} is not a JSON object; fix it first`);
  }
  const voices = Array.isArray(meta.voices) ? [...(meta.voices as Json[])] : [];
  const generated = {
    path: take.audio,
    duration_s: round3(take.durationSeconds),
    words: take.words,
  };
  const at = voices.findIndex((voice) => String(voice?.id) === lineId);
  if (at >= 0) voices[at] = { ...voices[at], ...generated };
  else voices.push({ id: lineId, ...generated });
  const next: Json = { ...meta, voices };
  if ("total_duration_s" in meta) {
    next.total_duration_s = round3(
      voices.reduce((sum, voice) => sum + (Number(voice?.duration_s) || 0), 0),
    );
  }
  work.texts.set(AUDIO_META_FILE, JSON.stringify(next, null, 2));
}

function updatedManifest(manifest: NarrationManifest, line: NarrationLine, take: NarrationTake) {
  Object.assign(line, take.voice, { text: take.text, audio: take.audio });
  line.voiced = {
    ...line.voiced,
    textHash: narrationTextHash(take.text),
    voiceKey: narrationVoiceKey(line, manifest.defaults),
    audioHash: take.audioHash,
    at: new Date().toISOString(),
  };
  return serializeNarrationManifest(manifest);
}

/**
 * Everything `narration set` would write for a fresh take of one line, without writing it: the
 * clip's src and duration, that line's caption words, the caption-overrides indices after them,
 * the manifest entry, and the line's voice in audio_meta.json (its length and words). Refuses when
 * the longer take would run into the next narration clip.
 */
export function planNarrationSet(
  projectDir: string,
  manifest: NarrationManifest,
  lineId: string,
  take: NarrationTake,
  { allowOverlap = false }: { allowOverlap?: boolean } = {},
): NarrationSetPlan {
  const line = findNarrationLine(manifest, lineId);
  if (!line) throw new NarrationRefusal(`${NARRATION_FILE} has no line "${lineId}"`);
  const work: Working = { texts: new Map(), originals: new Map(), warnings: [] };
  const clip = linkedClip(projectDir, lineId, work);
  checkOverlap(projectDir, clip, take, allowOverlap, work);
  work.texts.set(
    clip.file,
    setAttributes(textOf(work, projectDir, clip.file), clip.tag, {
      src: take.audio,
      "data-duration": String(round3(take.durationSeconds)),
    }),
  );
  const edit = planCaptions(projectDir, manifest, line, clip, take, work);
  const overridesDropped = edit ? planOverrides(projectDir, edit, work) : 0;
  updatedAudioMeta(projectDir, lineId, take, work);
  const manifestBefore = readFileSync(join(projectDir, NARRATION_FILE), "utf8");
  work.texts.set(NARRATION_FILE, updatedManifest(manifest, line, take));
  work.originals.set(NARRATION_FILE, manifestBefore);
  const files = [...work.texts]
    .map(([file, after]) => ({ file, before: work.originals.get(file)!, after }))
    .filter(({ before, after }) => before !== after);
  return {
    line: lineId,
    files,
    captions: edit && { file: edit.file, removed: edit.removed.length, added: edit.added.length },
    overridesDropped,
    warnings: work.warnings,
  };
}

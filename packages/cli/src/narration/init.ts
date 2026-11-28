import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyFileMutations, fileContentVersion } from "@hyperframes/studio-server";
import {
  NARRATION_FILE,
  NARRATION_LINE_ATTR,
  NARRATION_VERSION,
  narrationVoiceKey,
  serializeNarrationManifest,
  type NarrationLine,
  type NarrationManifest,
} from "@hyperframes/parsers/narration";
import { narrationTextHash } from "@hyperframes/lint";
import { asOneEntry, historyWho } from "./history.js";
import {
  NarrationRefusal,
  audioTags,
  compositionOrigin,
  fileHash,
  findCaptions,
  projectHtmlFiles,
  readText,
  setAttributes,
  type AudioTag,
} from "./project.js";

export interface NarrationInitOptions {
  dir: string;
  force?: boolean;
  who?: string;
}

export interface NarrationInitResult {
  source: "media-use" | "clips";
  lines: string[];
  linked: string[];
  unlinked: string[];
  captions: string | null;
  files: string[];
}

interface Draft {
  id: string;
  text: string;
  audio: string;
}

const readJson = (path: string): Record<string, unknown> | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : null;

type Json = Record<string, unknown>;

/** audio_request.json's lines by id, for their text. */
function requestedLines(request: Json): Map<string, Json> {
  const lines = Array.isArray(request.lines) ? (request.lines as Json[]) : [];
  return new Map(lines.map((line) => [String(line.id), line]));
}

/** A line from one audio_meta.json voice: its text from the request, else the words it heard. */
function draftOf(voice: Json, requested: Map<string, Json>): Draft {
  const text = requested.get(String(voice.id))?.text;
  const heard = Array.isArray(voice.words)
    ? (voice.words as Json[]).map((word) => String(word.text ?? "")).join(" ")
    : "";
  return {
    id: String(voice.id),
    text: typeof text === "string" ? text : heard,
    audio: String(voice.path),
  };
}

/** The voice media-use spoke the lines in: its provider and voice, the request's speed and language. */
function defaultsOf(meta: Json, request: Json) {
  const voice = meta.voice_id ?? request.voice;
  return {
    provider: String(meta.tts_provider ?? "kokoro"),
    ...(typeof voice === "string" && { voice }),
    speed: Number(request.speed ?? 1),
    ...(typeof request.lang === "string" && { lang: request.lang }),
  };
}

/** Lines from a media-use run: audio_meta.json's voices, with their text from audio_request.json. */
function fromMediaUse(projectDir: string) {
  const meta = readJson(join(projectDir, "audio_meta.json"));
  const voices = Array.isArray(meta?.voices) ? (meta.voices as Json[]) : [];
  if (!meta || voices.length === 0) return null;
  const request = readJson(join(projectDir, "audio_request.json")) ?? {};
  const requested = requestedLines(request);
  return {
    drafts: voices.map((voice) => draftOf(voice, requested)),
    defaults: defaultsOf(meta, request),
  };
}

/** Lines from clips already tagged with data-narration-line: their text comes from the captions. */
function fromTaggedClips(projectDir: string): Draft[] | null {
  const clips = projectHtmlFiles(projectDir).flatMap((file) =>
    audioTags(file, readText(projectDir, file)).filter((clip) => clip.line),
  );
  if (clips.length === 0) return null;
  const captions = findCaptions(projectDir, undefined);
  return clips.map((clip) => {
    const start = compositionOrigin(projectDir, clip.file) + clip.start - (captions?.origin ?? 0);
    const shown = (captions?.array.words ?? []).filter(
      (word) => word.startTime >= start - 0.1 && word.startTime < start + clip.duration,
    );
    return { id: clip.line!, text: shown.map((word) => word.text).join(" "), audio: clip.src };
  });
}

function voicedLine(projectDir: string, draft: Draft, manifest: NarrationManifest): NarrationLine {
  const audio = join(projectDir, draft.audio);
  return {
    ...draft,
    voiced: {
      textHash: narrationTextHash(draft.text),
      voiceKey: narrationVoiceKey({}, manifest.defaults),
      audioHash: existsSync(audio) ? fileHash(audio) : "",
      at: new Date().toISOString(),
    },
  };
}

/** Tags the clip that plays each line's audio; returns the edited files and which lines got a clip. */
function linkClips(projectDir: string, lines: NarrationLine[]) {
  const texts = new Map<string, string>();
  const linked: string[] = [];
  for (const line of lines) {
    const clip = projectHtmlFiles(projectDir)
      .flatMap((file) => audioTags(file, texts.get(file) ?? readText(projectDir, file)))
      .find((candidate: AudioTag) => candidate.src === line.audio);
    if (!clip) continue;
    linked.push(line.id);
    if (clip.line === line.id) continue;
    const html = texts.get(clip.file) ?? readText(projectDir, clip.file);
    texts.set(clip.file, setAttributes(html, clip.tag, { [NARRATION_LINE_ATTR]: line.id }));
  }
  return { texts, linked };
}

/**
 * Creates narration.json for a project that was voiced before it existed: from media-use's
 * audio_meta.json and audio_request.json when present, else from clips already tagged with
 * data-narration-line and the caption words inside them. Tags each line's clip; caption words stay
 * untagged and are matched by their clip's time window. Lengths and word timings stay in
 * audio_meta.json; narration.json records the script and what each line was voiced from.
 */
export async function runNarrationInit(
  options: NarrationInitOptions,
): Promise<NarrationInitResult> {
  const projectDir = options.dir;
  const manifestPath = join(projectDir, NARRATION_FILE);
  if (existsSync(manifestPath) && !options.force) {
    throw new NarrationRefusal(`${NARRATION_FILE} already exists; pass --force to rebuild it`);
  }
  const mediaUse = fromMediaUse(projectDir);
  const drafts = mediaUse?.drafts ?? fromTaggedClips(projectDir);
  if (!drafts) {
    throw new NarrationRefusal(
      `Nothing to adopt: no audio_meta.json voices and no <audio ${NARRATION_LINE_ATTR}> clips`,
    );
  }
  const captions = findCaptions(projectDir, undefined);
  const manifest: NarrationManifest = {
    version: NARRATION_VERSION,
    defaults: mediaUse?.defaults ?? { provider: "kokoro", speed: 1 },
    ...(captions && { captions: { file: captions.file, array: captions.array.name } }),
    lines: [],
  };
  manifest.lines = drafts.map((draft) => voicedLine(projectDir, draft, manifest));
  const { texts, linked } = linkClips(projectDir, manifest.lines);
  await asOneEntry(projectDir, "narration: init", historyWho(options.who), () => {
    applyFileMutations(
      projectDir,
      [...texts].map(([file, after]) => {
        const before = readText(projectDir, file);
        return {
          sourceFile: file,
          absPath: join(projectDir, file),
          before,
          after,
          expectedVersion: fileContentVersion(before),
        };
      }),
    );
    writeFileSync(manifestPath, serializeNarrationManifest(manifest));
  });
  const lines = manifest.lines.map((line) => line.id);
  return {
    source: mediaUse ? "media-use" : "clips",
    lines,
    linked,
    unlinked: lines.filter((id) => !linked.includes(id)),
    captions: captions?.file ?? null,
    files: [...texts.keys(), NARRATION_FILE],
  };
}

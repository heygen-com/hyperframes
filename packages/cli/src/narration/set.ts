import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyFileMutations, fileContentVersion } from "@hyperframes/studio-server";
import {
  AUDIO_META_FILE,
  NARRATION_FILE,
  findNarrationLine,
  narrationVoiceKey,
  narrationVoiceOf,
  type NarrationManifest,
  type NarrationVoiceSettings,
} from "@hyperframes/parsers/narration";
import { narrationTextHash } from "@hyperframes/lint";
import { isFileChanged } from "../timeline/a2Shared.js";
import { asOneEntry, historyWho } from "./history.js";
import { planNarrationSet, type NarrationSetPlan, type NarrationTake } from "./planSet.js";
import {
  CAPTION_OVERRIDES_FILE,
  NarrationRefusal,
  fileHash,
  projectHtmlFiles,
  readManifest,
  round3,
} from "./project.js";

export interface NarrationSetOptions {
  dir: string;
  line: string;
  text?: string;
  voice?: string;
  speed?: number;
  dryRun?: boolean;
  allowOverlap?: boolean;
  force?: boolean;
  who?: string;
}

export type NarrationSetResult =
  | { kind: "unchanged"; line: string }
  | ({ kind: "planned" | "written"; audio: string; durationSeconds: number; words: number } & Omit<
      NarrationSetPlan,
      "files"
    > & { files: string[] });

/** The voice settings the line will carry: its own, with any --voice / --speed on top. */
function voiceFor(
  manifest: NarrationManifest,
  options: NarrationSetOptions,
  current: NarrationVoiceSettings,
) {
  const own: NarrationVoiceSettings = {
    ...(current.voice !== undefined && { voice: current.voice }),
    ...(current.speed !== undefined && { speed: current.speed }),
    ...(options.voice !== undefined && { voice: options.voice }),
    ...(options.speed !== undefined && { speed: options.speed }),
  };
  const resolved = narrationVoiceOf({ ...current, ...own }, manifest.defaults);
  // One line is re-voiced alone, so the voice must give the same audio for the same text: then the
  // new take sounds like the lines around it. Kokoro runs locally and repeats; a cloud voice may not.
  if (resolved.provider !== "kokoro") {
    throw new NarrationRefusal(
      `narration set re-voices one line with Kokoro only, a local voice that sounds the same each time, so the line matches its neighbours. ${resolved.provider} voices may not repeat; re-voice every line with media-use (--only tts) instead`,
    );
  }
  return { own, resolved };
}

/** Voices `text` with Kokoro and transcribes that clip alone, both in a folder outside the project. */
async function voiceInScratch(
  text: string,
  voice: ReturnType<typeof narrationVoiceOf>,
  scratch: string,
) {
  const { synthesize } = await import("../tts/synthesize.js");
  const { isSupportedLang } = await import("../tts/manager.js");
  const wav = join(scratch, "voice.wav");
  const spoken = await synthesize(text, wav, {
    ...(voice.voice && { voice: voice.voice }),
    speed: voice.speed,
    ...(isSupportedLang(voice.lang) && { lang: voice.lang }),
  });
  const { runTranscribe } = await import("../api/transcribe.js");
  const { loadTranscript } = await import("../whisper/normalize.js");
  const heard = await runTranscribe({ input: wav, dir: scratch });
  if (heard.kind !== "transcribed") throw new Error(`transcribe returned ${heard.kind}`);
  const words = loadTranscript(heard.transcriptPath).words.map(({ text: said, start, end }) => ({
    text: said,
    start,
    end,
  }));
  if (words.length === 0) {
    throw new NarrationRefusal("No words were heard in the new take; nothing was changed");
  }
  return { wav, durationSeconds: spoken.durationSeconds, words };
}

function alreadyVoiced(
  projectDir: string,
  manifest: NarrationManifest,
  line: string,
  text: string,
  voiceKey: string,
) {
  const entry = findNarrationLine(manifest, line)!;
  const audio = join(projectDir, entry.audio);
  return (
    entry.voiced?.textHash === narrationTextHash(text) &&
    entry.voiced.voiceKey === voiceKey &&
    existsSync(audio) &&
    entry.voiced.audioHash === fileHash(audio)
  );
}

/** The files `set` may rewrite, as they were before the slow voicing step began. */
function snapshot(projectDir: string): Map<string, string> {
  const files = [
    ...projectHtmlFiles(projectDir),
    CAPTION_OVERRIDES_FILE,
    NARRATION_FILE,
    AUDIO_META_FILE,
  ];
  return new Map(
    files
      .filter((file) => existsSync(join(projectDir, file)))
      .map((file) => [file, readFileSync(join(projectDir, file), "utf8")]),
  );
}

function applyPlan(
  projectDir: string,
  plan: NarrationSetPlan,
  take: NarrationTake,
  wav: string,
  atStart: Map<string, string>,
) {
  const target = join(projectDir, take.audio);
  const created = !existsSync(target);
  mkdirSync(dirname(target), { recursive: true });
  if (created) copyFileSync(wav, target);
  try {
    applyFileMutations(
      projectDir,
      plan.files.map(({ file, before, after }) => ({
        sourceFile: file,
        absPath: join(projectDir, file),
        before,
        after,
        // Against the files as they were before voicing: an edit made meanwhile refuses the write.
        expectedVersion: fileContentVersion(atStart.get(file) ?? before),
      })),
    );
  } catch (error) {
    if (created) unlinkSync(target);
    if (isFileChanged(error)) {
      throw new NarrationRefusal(
        "A project file changed while the line was re-voiced; run the command again",
      );
    }
    throw error;
  }
}

/**
 * Re-voices one narration line: Kokoro into a scratch folder, transcribe that clip alone, then the
 * clip, its caption words, caption-overrides.json, narration.json and the line's voice in
 * audio_meta.json change together as one history entry. The take is written under a new, content-addressed name and the old WAV is kept,
 * so undo never points a clip at a deleted file. With `dryRun`, nothing in the project changes.
 */
export async function runNarrationSet(options: NarrationSetOptions): Promise<NarrationSetResult> {
  const projectDir = options.dir;
  const manifest = readManifest(projectDir);
  const line = findNarrationLine(manifest, options.line);
  if (!line) throw new NarrationRefusal(`narration.json has no line "${options.line}"`);
  const text = options.text ?? line.text;
  const { own, resolved } = voiceFor(manifest, options, line);
  const voiceKey = narrationVoiceKey({ ...line, ...own }, manifest.defaults);
  if (!options.force && alreadyVoiced(projectDir, manifest, line.id, text, voiceKey)) {
    return { kind: "unchanged", line: line.id };
  }
  const atStart = snapshot(projectDir);
  const scratch = mkdtempSync(join(tmpdir(), "hf-narration-"));
  try {
    const voiced = await voiceInScratch(text, resolved, scratch);
    const audioHash = fileHash(voiced.wav);
    const take: NarrationTake = {
      text,
      voice: own,
      audio: `assets/voice/${line.id}-${audioHash.slice(0, 8)}.wav`,
      audioHash,
      durationSeconds: voiced.durationSeconds,
      words: voiced.words,
    };
    const plan = planNarrationSet(projectDir, manifest, line.id, take, {
      allowOverlap: options.allowOverlap,
    });
    if (!options.dryRun) {
      await asOneEntry(projectDir, `narration: re-voice ${line.id}`, historyWho(options.who), () =>
        applyPlan(projectDir, plan, take, voiced.wav, atStart),
      );
    }
    return {
      ...plan,
      kind: options.dryRun ? "planned" : "written",
      files: plan.files.map(({ file }) => file),
      audio: take.audio,
      durationSeconds: round3(take.durationSeconds),
      words: take.words.length,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

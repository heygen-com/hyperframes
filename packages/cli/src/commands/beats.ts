import { failCommand } from "../utils/commandResult.js";
import { defineCommand } from "../utils/defineCommand.js";
import { existsSync, readFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import {
  analyzeMusicFromSignal,
  audioRelPathForSrc,
  findMusicAudioSrc,
  serializeBeats,
  type MusicBeatAnalysis,
} from "@hyperframes/core/beats";
import { parseHTMLContent } from "@hyperframes/core/compiler";
import { walkCompositionDescendants } from "@hyperframes/parsers";
import { isSafePath, resolveWithinProject } from "@hyperframes/core";
import type { Example } from "./_examples.js";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import type { AudioSignal } from "@hyperframes/core/audio-analysis";
import { decodeAudio } from "../audio/analysis/decode.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Generate the beat file for the current project", "hyperframes beats"],
  ["Generate for a specific directory", "hyperframes beats ./my-video"],
  ["Beats of a single audio file", "hyperframes audio music.mp3 --only beats --json"],
];

function fail(message: string): never {
  console.error(c.error(message));
  failCommand();
}

function mediaSrc(element: Element): string | null {
  return (
    Array.from(element.attributes).find((attribute) => attribute.name.toLowerCase() === "src")
      ?.value ?? null
  );
}

function findMusicSrc(html: string): string | null {
  const document = parseHTMLContent(html);
  walkCompositionDescendants(document, (element) => {
    const tag = element.tagName.toLowerCase();
    if ((tag !== "audio" && tag !== "video") || mediaSrc(element)) return;
    const sources = Array.from(element.querySelectorAll("source"))
      .map(mediaSrc)
      .filter((src): src is string => Boolean(src));
    const src = sources.find((value) => !/^https?:\/\//i.test(value)) ?? sources[0];
    if (src) element.setAttribute("src", src);
  });
  return findMusicAudioSrc(document.toString());
}

const NO_MUSIC_TRACK =
  'No music track found. Add data-timeline-role="music" to the <audio> element, or to a ' +
  '<video data-has-audio="true"> whose own sound is the music ' +
  "(or give it an id like music/bgm/soundtrack).";

/** Locate the music track + its on-disk audio: null when the composition has none, or fail with a clear message. */
function resolveMusicTarget(project: ProjectDir): { rel: string; audioPath: string } | null {
  const src = findMusicSrc(readFileSync(project.indexPath, "utf-8"));
  if (!src) return null;
  const rel = audioRelPathForSrc(src); // same derivation the Studio uses
  if (!rel) fail(`Cannot derive a beat-file path for music src: ${src}`);
  const audioPath = resolveWithinProject(project.dir, rel);
  if (!audioPath) fail(`Music src resolves outside the project: ${src}`);
  if (!existsSync(audioPath)) fail(`Audio file not found: ${rel}`);
  return { rel, audioPath };
}

function answerNoTrack(json: boolean): void {
  if (!json) fail(NO_MUSIC_TRACK);
  console.log(JSON.stringify({ ok: true, track: null, file: null, count: 0, bpm: null }, null, 2));
}

async function decode(audioPath: string): Promise<AudioSignal> {
  try {
    const decoded = await decodeAudio(audioPath);
    if (decoded) return decoded.signal;
  } catch (err) {
    fail(`Beat detection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  fail(`Beat detection failed: ${audioPath} has no audio stream`);
}

function report(file: string, result: MusicBeatAnalysis, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify({ ok: true, file, count: result.beatTimes.length, bpm: result.bpm }, null, 2),
    );
    return;
  }
  console.log(
    c.success(
      `✓ Wrote ${result.beatTimes.length} beats → ${file} (bpm ${result.bpm ?? "?"}, ${result.bpmConfidence})`,
    ),
  );
}

export default defineCommand({
  meta: {
    name: "beats",
    description: "Detect beats in the music track and write beats/<audio>.json",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  async run({ args }) {
    if (args.dir && existsSync(resolve(args.dir)) && statSync(resolve(args.dir)).isFile()) {
      const file = JSON.stringify(args.dir);
      fail(
        /\.html?$/i.test(args.dir)
          ? `${args.dir} is a file; beats takes the project folder: hyperframes beats ${JSON.stringify(dirname(args.dir))}`
          : `${args.dir} is a file; beats takes a project folder. ` +
              `For one audio or video file run: hyperframes audio ${file} --only beats --json`,
      );
    }
    const project = resolveProject(args.dir);
    const target = resolveMusicTarget(project);
    if (!target) return answerNoTrack(Boolean(args.json));
    const { rel, audioPath } = target;
    if (!args.json) console.log(c.dim(`Analyzing ${rel}…`));

    const result = await analyzeMusicFromSignal(await decode(audioPath));
    // The Studio ignores a 0-beat file (treats it as a stale seed), so don't write one.
    if (result.beatTimes.length === 0) {
      fail(`No beats detected in ${rel} — nothing written. (Track may be silent/ambient.)`);
    }

    const outPath = join(project.dir, "beats", `${rel}.json`);
    if (!isSafePath(project.dir, outPath))
      fail(`Beat file path resolves outside the project: ${rel}`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serializeBeats(result.beatTimes, result.beatStrengths, rel));
    report(`beats/${rel}.json`, result, Boolean(args.json));
  },
});

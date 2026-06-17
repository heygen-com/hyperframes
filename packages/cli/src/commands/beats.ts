import { defineCommand } from "citty";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { findMusicAudioSrc, audioRelPathForSrc, serializeBeats } from "@hyperframes/core/beats";
import type { Example } from "./_examples.js";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import { analyzeBeatsHeadless, type HeadlessBeatResult } from "../beats/headlessAnalyzer.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Generate the beat file for the current project", "hyperframes beats"],
  ["Generate for a specific directory", "hyperframes beats ./my-video"],
];

function fail(message: string): never {
  console.error(c.error(message));
  process.exit(1);
}

/** Locate the music track + its on-disk audio, or fail with a clear message. */
function resolveMusicTarget(project: ProjectDir): { rel: string; audioPath: string } {
  const src = findMusicAudioSrc(readFileSync(project.indexPath, "utf-8"));
  if (!src) {
    fail(
      'No music track found. Add data-timeline-role="music" to the <audio> element ' +
        "(or give it an id like music/bgm/soundtrack).",
    );
  }
  const rel = audioRelPathForSrc(src); // same derivation the Studio uses
  if (!rel) fail(`Cannot derive a beat-file path for music src: ${src}`);
  const audioPath = resolve(project.dir, rel);
  if (!existsSync(audioPath)) fail(`Audio file not found: ${rel}`);
  return { rel, audioPath };
}

async function detect(audioPath: string): Promise<HeadlessBeatResult> {
  try {
    return await analyzeBeatsHeadless(readFileSync(audioPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /chrome|executable|browser|ENOENT/i.test(msg)
      ? "\nRun: npx hyperframes browser ensure"
      : "";
    fail(`Beat detection failed: ${msg}${hint}`);
  }
}

function report(file: string, result: HeadlessBeatResult, json: boolean): void {
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
    description: "Detect beats in the music track (headless) and write beats/<audio>.json",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const { rel, audioPath } = resolveMusicTarget(project);
    if (!args.json) console.log(c.dim(`Analyzing ${rel} in headless Chrome…`));

    const result = await detect(audioPath);
    // The Studio ignores a 0-beat file (treats it as a stale seed), so don't write one.
    if (result.beatTimes.length === 0) {
      fail(`No beats detected in ${rel} — nothing written. (Track may be silent/ambient.)`);
    }

    const outPath = join(project.dir, "beats", `${rel}.json`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serializeBeats(result.beatTimes, result.beatStrengths, rel));
    report(`beats/${rel}.json`, result, Boolean(args.json));
  },
});

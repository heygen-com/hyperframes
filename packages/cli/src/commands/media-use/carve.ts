import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as carve from "@hyperframes/core/audio-carve";
import * as fx from "@hyperframes/core/audio-fx";
import { findFFmpeg, getFFmpegInstallHint } from "../../browser/ffmpeg.js";
import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";

export const examples: Example[] = [
  [
    "Make room in the music bed for every voice over it",
    "hyperframes media-use carve --comp index.html",
  ],
  [
    "Name the bed and the voices, and see the plan without writing it",
    "hyperframes media-use carve --comp index.html --bed music --voice narration --dry-run",
  ],
];

const CARVE_SCRIPT = ["skills", "media-use", "audio", "scripts", "carve.mjs"];

/** The carve script this CLI ships: next to the bundle when built, at the repo root in a checkout. */
export function resolveCarveScript(
  here: string,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const candidates = [join(here, ...CARVE_SCRIPT), join(here, "../../../../..", ...CARVE_SCRIPT)];
  const script = candidates.find((candidate) => fileExists(candidate));
  if (!script) {
    throw new Error(
      "the carve script is missing from this CLI build; reinstall the CLI or run from a source checkout",
    );
  }
  return script;
}

type CarveScript = {
  carveComposition: (argv: string[], core: unknown, ffmpeg: string) => Promise<void>;
};

export default defineCommand({
  meta: {
    name: "carve",
    description:
      "Carve the music bed around the voices over it: dips only the bands they use, plus a level match. The same analysis as Studio's carve panel",
  },
  args: {
    comp: { type: "string", description: "The composition file to carve, e.g. index.html" },
    bed: { type: "string", description: "id of the music track that gets carved (detected)" },
    voice: { type: "string", description: "id of a voice to make room for; repeatable (detected)" },
    strength: { type: "string", description: "How hard to carve, 0 to 1 (default 0.8)" },
    "dry-run": { type: "boolean", description: "Report what it would write, touch nothing" },
  },
  async run() {
    const ffmpeg = findFFmpeg();
    if (!ffmpeg) throw new Error(`FFmpeg is required. ${getFFmpegInstallHint()}`);
    const script = resolveCarveScript(dirname(fileURLToPath(import.meta.url)));
    const { carveComposition }: CarveScript = await import(pathToFileURL(script).href);
    const argv = process.argv.slice(process.argv.indexOf("media-use") + 2);
    await carveComposition(argv, { carve, fx }, ffmpeg);
  },
});

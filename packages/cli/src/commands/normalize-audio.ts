import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
  absoluteLoudnessPlan,
  audioNormalizationPlan,
  audioTags,
  DEFAULT_TARGET_LUFS,
  measureAudio,
  requiredFfmpeg,
  resolveLocalAudioPath,
  updateAudioVolume,
  type AbsoluteLoudnessPlan,
  type AudioNormalizationPlan,
  type AudioTag,
  type LoudnessLimit,
} from "@hyperframes/studio-server/loudness";
import { defineCommand } from "citty";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { failCommand } from "../utils/commandResult.js";
import type { Example } from "./_examples.js";

export {
  audioNormalizationPlan,
  audioTags,
  loudnessMeasureArgs,
  parseEbur128Summary,
  resolveLocalAudioPath,
  updateAudioVolume,
} from "@hyperframes/studio-server/loudness";

const DEFAULT_TOLERANCE_LU = 0.5;

function fail(message: string, json: boolean, cause?: unknown): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(c.error(message));
  failCommand(1, cause);
}

function byId(tags: readonly AudioTag[], rawId: string, role: string): AudioTag {
  const id = rawId.trim().replace(/^#/, "");
  const tag = tags.find((candidate) => candidate.id === id);
  if (!tag) throw new Error(`${role} audio #${id} was not found`);
  return tag;
}

interface NormalizeAudioOptions {
  dir?: string;
  reference?: string;
  target: string;
  lufs: string;
  tolerance: string;
  write: boolean;
}

interface WriteOutcome {
  ok: true;
  wrote: boolean;
  withinTolerance: boolean;
  tolerance: number;
  indexPath: string;
}

type NormalizeAudioResult = WriteOutcome & ModePlan;

function selectedTags(html: string, referenceId: string, targetId: string) {
  const tags = audioTags(html);
  const referenceTag = byId(tags, referenceId, "Reference");
  const targetTag = byId(tags, targetId, "Target");
  if (referenceTag.id === targetTag.id) {
    throw new Error("Reference and target must be different audio elements");
  }
  return { referenceTag, targetTag };
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

function parsedLufs(raw: string): number {
  const lufs = Number(raw);
  if (!Number.isFinite(lufs) || lufs >= 0) throw new Error("--lufs must be a negative number");
  return lufs;
}

async function measuredAbsolutePlan(
  projectDir: string,
  targetTag: AudioTag,
  targetLufs: number,
): Promise<AbsoluteLoudnessPlan> {
  const measurement = await measureAudio(
    requiredFfmpeg(),
    existingAudioFile(projectDir, targetTag),
    targetTag,
  );
  return absoluteLoudnessPlan(
    { id: targetTag.id, volume: targetTag.volume, ...measurement },
    targetLufs,
  );
}

type ModePlan =
  | (AudioNormalizationPlan & { mode: "reference" })
  | (AbsoluteLoudnessPlan & { mode: "absolute" });

async function plannedNormalization(
  projectDir: string,
  html: string,
  options: NormalizeAudioOptions,
  tolerance: number,
): Promise<{ targetTag: AudioTag; withinTolerance: boolean; plan: ModePlan }> {
  if (options.reference === undefined) {
    const targetTag = byId(audioTags(html), options.target, "Target");
    const plan = await measuredAbsolutePlan(projectDir, targetTag, parsedLufs(options.lufs));
    const withinTolerance = targetTag.volume > 0 && Math.abs(plan.changeDb) <= tolerance;
    return { targetTag, withinTolerance, plan: { mode: "absolute", ...plan } };
  }
  const { referenceTag, targetTag } = selectedTags(html, options.reference, options.target);
  const plan = await measuredPlan(projectDir, referenceTag, targetTag);
  const withinTolerance = Math.abs(plan.referenceLufs - plan.targetLufs) <= tolerance;
  return { targetTag, withinTolerance, plan: { mode: "reference", ...plan } };
}

async function normalizeAudio(options: NormalizeAudioOptions): Promise<NormalizeAudioResult> {
  const project = resolveProject(options.dir);
  const html = readFileSync(project.indexPath, "utf8");
  const tolerance = parsedTolerance(options.tolerance);
  const { targetTag, withinTolerance, plan } = await plannedNormalization(
    project.dir,
    html,
    options,
    tolerance,
  );
  const wrote = options.write && !withinTolerance;
  if (wrote) {
    writeAtomically(
      project.indexPath,
      updateAudioVolume(readFileSync(project.indexPath, "utf8"), targetTag.id, plan.volume),
    );
  }
  return { ok: true, wrote, withinTolerance, tolerance, indexPath: project.indexPath, ...plan };
}

const LIMIT_TEXT: Record<LoudnessLimit, string> = {
  "gain-ceiling": "stopped at the +12 dB authoring ceiling",
  "true-peak": "stopped short of -1.5 dBTP",
};

function printMeasuredLine(result: NormalizeAudioResult): void {
  if (result.mode === "reference") {
    console.log(
      `${c.bold(`#${result.referenceId}`)} ${result.referenceLufs.toFixed(1)} LUFS → ` +
        `${c.bold(`#${result.targetId}`)} ${result.targetLufs.toFixed(1)} LUFS`,
    );
    return;
  }
  const limit = result.limitedBy ? ` (${LIMIT_TEXT[result.limitedBy]})` : "";
  console.log(
    `${c.bold(`#${result.targetId}`)} ${result.sourceLufs.toFixed(1)} LUFS → ` +
      `${result.projectedLufs.toFixed(1)} LUFS, target ${result.targetLufs.toFixed(1)}${limit}`,
  );
}

function printHumanResult(result: NormalizeAudioResult): void {
  printMeasuredLine(result);
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
    "Bring one clip (audio or a video with sound) to -16 LUFS",
    "hyperframes normalize-audio --target voiceover --write",
  ],
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
    description:
      "Normalize a clip with sound to an absolute LUFS target, or match it to another clip",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    reference: {
      type: "string",
      description:
        "Audio or video element id whose effective loudness should be preserved (omit to use --lufs)",
      required: false,
    },
    target: {
      type: "string",
      description: "Audio or video element id whose data-volume should be set",
      required: true,
    },
    lufs: {
      type: "string",
      description: `Absolute integrated loudness target without --reference (default ${DEFAULT_TARGET_LUFS})`,
      default: String(DEFAULT_TARGET_LUFS),
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
        lufs: args.lufs,
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
      fail(error instanceof Error ? error.message : String(error), Boolean(args.json), error);
    }
  },
});

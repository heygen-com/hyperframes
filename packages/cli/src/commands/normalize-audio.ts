import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  absoluteLoudnessPlan,
  absoluteOutcome,
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
import { resolveAuthoredAssetFile } from "@hyperframes/parsers/asset-resolution";
import { defineCommand } from "../utils/defineCommand.js";
import { c } from "../ui/colors.js";
import { projectCompositionFiles } from "../utils/mountedCompositions.js";
import { resolveProject } from "../utils/project.js";
import { CliUsageError, failCommand, failUsage } from "../utils/commandResult.js";
import type { Example } from "./_examples.js";
import { jsonFailure } from "../utils/jsonError.js";

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
  const usage = cause instanceof CliUsageError;
  if (json) {
    console.log(
      JSON.stringify(jsonFailure(usage ? cause.code : "runtime_error", message), null, 2),
    );
  } else console.error(c.error(message));
  if (usage) failUsage();
  failCommand(1, cause);
}

type ProjectAudioTag = AudioTag & { file: string };

function projectAudioTags(projectDir: string): ProjectAudioTag[] {
  return projectCompositionFiles(projectDir).flatMap((file) =>
    audioTags(readFileSync(resolve(projectDir, file), "utf8")).map((tag) => ({ ...tag, file })),
  );
}

function byId(tags: readonly ProjectAudioTag[], rawId: string, role: string): ProjectAudioTag {
  const id = rawId.trim().replace(/^#/, "");
  const matches = tags.filter((candidate) => candidate.id === id);
  if (matches.length > 1) {
    throw new Error(`${role} audio #${id} is declared in ${matches.map((m) => m.file).join(", ")}`);
  }
  if (!matches[0]) throw new Error(`${role} audio #${id} was not found`);
  return matches[0];
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
  filePath: string;
}

type NormalizeAudioResult = WriteOutcome & ModePlan;

function selectedTags(tags: readonly ProjectAudioTag[], referenceId: string, targetId: string) {
  const referenceTag = byId(tags, referenceId, "Reference");
  const targetTag = byId(tags, targetId, "Target");
  if (referenceTag.id === targetTag.id) {
    throw new CliUsageError("Reference and target must be different audio elements");
  }
  return { referenceTag, targetTag };
}

function existingAudioFile(projectDir: string, tag: ProjectAudioTag): string {
  const file =
    resolveAuthoredAssetFile(projectDir, tag.file, tag.src) ??
    resolveLocalAudioPath(projectDir, tag.src);
  if (!existsSync(file)) {
    throw new Error(`Audio #${tag.id} file was not found: ${relative(projectDir, file)}`);
  }
  return file;
}

async function measuredPlan(
  projectDir: string,
  referenceTag: ProjectAudioTag,
  targetTag: ProjectAudioTag,
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
    throw new CliUsageError("--tolerance must be a non-negative number");
  }
  return tolerance;
}

function parsedLufs(raw: string): number {
  const lufs = Number(raw);
  if (!Number.isFinite(lufs) || lufs >= 0)
    throw new CliUsageError("--lufs must be a negative number");
  return lufs;
}

async function measuredAbsolutePlan(
  projectDir: string,
  targetTag: ProjectAudioTag,
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
  tags: readonly ProjectAudioTag[],
  options: NormalizeAudioOptions,
  tolerance: number,
): Promise<{ targetTag: ProjectAudioTag; withinTolerance: boolean; plan: ModePlan }> {
  if (options.reference === undefined) {
    const targetTag = byId(tags, options.target, "Target");
    const plan = await measuredAbsolutePlan(projectDir, targetTag, parsedLufs(options.lufs));
    const withinTolerance = targetTag.volume > 0 && absoluteOutcome(plan, tolerance) === "matched";
    return { targetTag, withinTolerance, plan: { mode: "absolute", ...plan } };
  }
  const { referenceTag, targetTag } = selectedTags(tags, options.reference, options.target);
  const plan = await measuredPlan(projectDir, referenceTag, targetTag);
  const withinTolerance = Math.abs(plan.referenceLufs - plan.targetLufs) <= tolerance;
  return { targetTag, withinTolerance, plan: { mode: "reference", ...plan } };
}

async function normalizeAudio(options: NormalizeAudioOptions): Promise<NormalizeAudioResult> {
  const tolerance = parsedTolerance(options.tolerance);
  const project = resolveProject(options.dir);
  const tags = projectAudioTags(project.dir);
  const { targetTag, withinTolerance, plan } = await plannedNormalization(
    project.dir,
    tags,
    options,
    tolerance,
  );
  const filePath = resolve(project.dir, targetTag.file);
  const heldByLimit =
    plan.mode === "absolute" && targetTag.volume > 0 && absoluteOutcome(plan, tolerance) === "held";
  const wrote = options.write && !withinTolerance && !heldByLimit;
  if (wrote) {
    writeAtomically(
      filePath,
      updateAudioVolume(readFileSync(filePath, "utf8"), targetTag.id, plan.volume),
    );
  }
  return { ok: true, wrote, withinTolerance, tolerance, filePath, ...plan };
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

  if (
    result.mode === "absolute" &&
    result.previousVolume > 0 &&
    absoluteOutcome(result, result.tolerance) === "held"
  ) {
    console.log(c.dim("Cannot get closer to the target; the gain is unchanged."));
    return;
  }

  console.log(
    `Set #${result.targetId} data-volume ${result.previousVolume.toFixed(3)} → ${result.volume.toFixed(6)} ` +
      `(${result.changeDb >= 0 ? "+" : ""}${result.changeDb.toFixed(1)} dB).`,
  );
  console.log(
    result.wrote
      ? c.success(`Updated ${relative(process.cwd(), result.filePath) || "index.html"}.`)
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
        const { filePath: _, ...jsonResult } = result;
        console.log(JSON.stringify(jsonResult, null, 2));
        return;
      }
      printHumanResult(result);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), Boolean(args.json), error);
    }
  },
});

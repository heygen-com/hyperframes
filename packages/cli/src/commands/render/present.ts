import { cpus } from "node:os";
import { readFileSync } from "node:fs";
import { fpsToFfmpegArg } from "@hyperframes/core";
import { c } from "../../ui/colors.js";
import type { MotionBlurOptions } from "@hyperframes/engine";
import type { RenderPlan } from "./plan.js";

/** Present warnings and the human render plan. JSON batch output stays silent. */
// This phase intentionally owns every mutually exclusive human-output branch.
// fallow-ignore-next-line complexity
export async function presentRenderPlan(plan: RenderPlan): Promise<void> {
  await presentRenderWarnings(plan);
  if (plan.effectiveQuiet || plan.batchPath) return;
  presentRenderSummary(plan);
}

async function presentRenderWarnings(plan: RenderPlan): Promise<void> {
  if (plan.invalidAuthoringSkill) {
    process.stderr.write(
      `hyperframes: ignoring --skill="${plan.invalidAuthoringSkill}" — not a valid slug ` +
        "(lowercase letters/digits/hyphens, max 64); this render will be unattributed.\n",
    );
  }
  if (!plan.effectiveQuiet && plan.gifFpsCapped) {
    console.log(c.warn("  GIF output is capped at 30fps. Use --fps 15 for smaller files."));
  }
  if (!plan.effectiveQuiet) await warnForSlideshow(plan);
}

function presentRenderSummary(plan: RenderPlan): void {
  const workerLabel =
    plan.workers != null
      ? `${plan.workers} workers`
      : `auto workers (${cpus().length} cores detected)`;
  const nameLabel = plan.entryFile ? `${plan.project.name}/${plan.entryFile}` : plan.project.name;
  console.log("");
  console.log(
    c.accent("\u25C6") + "  Rendering " + c.accent(nameLabel) + c.dim(" \u2192 " + plan.outputPath),
  );
  console.log(
    c.dim(`   ${fpsToFfmpegArg(plan.fps)}fps \u00B7 ${plan.quality} \u00B7 ${workerLabel}`),
  );
  if (plan.outputResolution) {
    console.log(c.dim("   Output resolution: " + plan.outputResolution));
  }
  if (plan.format === "hls") {
    console.log(c.dim(`   HLS: ${plan.hlsSegmentSeconds}s segments in a playlist directory`));
  }
  if (plan.motionBlur) {
    // Preview is sharp under this route: the smear is integrated during frame
    // capture, so `hyperframes preview` and Studio show the composition
    // unblurred. Say so rather than letting an author read the sharp preview
    // as the blur having failed.
    console.log(
      c.dim(`   Motion blur: ${formatMotionBlurLabel(plan.motionBlur)} (preview stays sharp)`),
    );
  }
  const gpuModes = formatGpuModes(plan);
  if (gpuModes) console.log(c.dim("   GPU: " + gpuModes));
  console.log("");
}

/** Human label for the resolved motion-blur shutter, for the plan summary. */
function formatMotionBlurLabel(options: MotionBlurOptions): string {
  const parts: string[] = [];
  parts.push(`${options.shutterAngle ?? 180}deg shutter`);
  if (options.shutterPhase !== undefined) parts.push(`phase ${options.shutterPhase}`);
  parts.push(
    options.samplesPerFrame !== undefined
      ? `${options.samplesPerFrame} samples/frame`
      : "adaptive samples",
  );
  return parts.join(", ");
}

/** The GPU line's accelerated modes, or undefined when neither is. */
function formatGpuModes(plan: RenderPlan): string | undefined {
  const modes: string[] = [];
  if (plan.useGpu) modes.push("encoder GPU");
  if (plan.browserGpuMode === "hardware") modes.push("browser GPU (forced)");
  else if (plan.browserGpuMode === "auto") modes.push("browser GPU (auto-detect)");
  return modes.length > 0 ? modes.join(" + ") : undefined;
}

async function warnForSlideshow(plan: RenderPlan): Promise<void> {
  try {
    const { slideshowIslandRegex } = await import("@hyperframes/core/slideshow");
    if (!slideshowIslandRegex("i").test(readFileSync(plan.renderTarget, "utf8"))) return;
    console.log(
      c.warn("⚠") +
        "  This composition carries a slideshow island — `render` captures only the first" +
        " scene, so the MP4 will be truncated to slide 1. Use " +
        c.accent("hyperframes present") +
        " for the deck; a linear main-line MP4 export is not yet available.",
    );
    console.log("");
  } catch {
    // Best-effort only; the execution pipeline owns real file failures.
  }
}

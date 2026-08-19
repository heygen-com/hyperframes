import { cpus } from "node:os";
import { readFileSync } from "node:fs";
import { fpsToFfmpegArg } from "@hyperframes/core";
import { c } from "../../ui/colors.js";
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
  if (plan.useGpu || plan.browserGpuMode !== "software") {
    const gpuModes = [
      plan.useGpu ? "encoder GPU" : null,
      plan.browserGpuMode === "hardware"
        ? "browser GPU (forced)"
        : plan.browserGpuMode === "auto"
          ? "browser GPU (auto-detect)"
          : null,
    ].filter(Boolean);
    console.log(c.dim("   GPU: " + gpuModes.join(" + ")));
  }
  console.log("");
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

// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HF_COLOR_GRADING_PALETTES } from "@hyperframes/core";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");

describe("hyperframes-core contract docs", () => {
  it("keeps root data-start in the minimal composition skeleton", () => {
    const minimal = read("skills", "hyperframes-core", "references", "minimal-composition.md");

    expect(minimal).toMatch(/data-composition-id="main"[\s\S]{0,300}data-start="0"/);
    expect(minimal).toContain('Root `<div>` with `data-composition-id`, `data-start="0"`');
  });

  it("teaches check as the canonical quality gate", () => {
    const skill = read("skills", "hyperframes-core", "SKILL.md");
    const brief = read("skills", "hyperframes-core", "references", "brief-contract.md");

    expect(skill).toContain("`npx hyperframes check`");
    expect(brief).toContain("`hyperframes check`");
    expect(brief).not.toContain("`lint` / `validate` / `inspect`");
  });

  it("requires actionable reproduction packets in CLI defect feedback", () => {
    const skill = read("skills", "hyperframes-cli", "SKILL.md");
    const renderReference = read("skills", "hyperframes-cli", "references", "preview-render.md");

    expect(skill).toContain("reproduction packet");
    expect(renderReference).toContain("REPRO COMMAND:");
    expect(renderReference).toContain("EXPECTED / ACTUAL:");
    expect(renderReference).toContain("EXACT ERROR:");
    expect(renderReference).toContain("OUTCOME:");
    expect(renderReference).toContain("WORKAROUND:");
  });

  it("mandates a composition-structure block for visual-defect feedback", () => {
    const skill = read("skills", "hyperframes-cli", "SKILL.md");
    const renderReference = read("skills", "hyperframes-cli", "references", "preview-render.md");

    // Skill teaches the mandate at a high level.
    expect(skill).toContain("COMPOSITION_STRUCTURE:");
    // Reference carries the fillable block + agent-helper pointer.
    expect(renderReference).toContain("COMPOSITION_STRUCTURE:");
    expect(renderReference).toContain("elements: video=");
    expect(renderReference).toContain("attributes:");
    expect(renderReference).toContain("timeline:");
    expect(renderReference).toContain("buildCompositionCensus");
  });

  it("teaches safe cloud archive size remediation", () => {
    const skill = read("skills", "hyperframes-cli", "SKILL.md");
    const cloudReference = read("skills", "hyperframes-cli", "references", "cloud.md");

    expect(skill).toContain("cloud render --dry-run --json");
    expect(skill).toContain("Never ignore an asset merely because it is large");
    expect(cloudReference).toContain(".hyperframesignore");
    expect(cloudReference).toContain("Never ignore all of `assets/`");
    expect(cloudReference).toContain("dynamically computed asset path");
  });
});

describe("media-use TTS documentation", () => {
  it("does not advertise flags unsupported by the published tts command", () => {
    const tts = read("skills", "media-use", "audio", "references", "tts.md");
    const captions = read("skills", "media-use", "audio", "references", "tts-to-captions.md");

    expect(tts).not.toMatch(/hyperframes tts[^\n]*--provider/);
    expect(tts).not.toMatch(/hyperframes tts[^\n]*--words/);
    expect(captions).not.toMatch(/hyperframes tts[^\n]*--provider/);
    expect(captions).toContain("heygen-tts.mjs");
  });
});

describe("media treatment routing documentation", () => {
  it("routes broad media feedback through media-use to deterministic persistence", () => {
    const router = read("skills", "hyperframes", "SKILL.md");
    const mediaUse = read("skills", "media-use", "SKILL.md");
    const treatments = read("skills", "media-use", "references", "media-treatments.md");

    expect(router).toContain("dark/flat/boring footage");
    expect(router).toContain("`/media-use`");
    expect(router).toMatch(/do not substitute a\s+generic LUT/);
    expect(mediaUse).toContain("references/media-treatments.md");
    expect(mediaUse).toContain("`hyperframes media-treatment`");
    expect(mediaUse).toContain("Do not generate a `.cube` LUT");
    expect(mediaUse).toMatch(/Do not recreate supported vignette, grain, blur, pixelate/);
    expect(mediaUse).toContain("Photographic media that feels visually flat or off-topic");
    expect(mediaUse).toContain("A meaningful media entrance/reveal that feels static");
    expect(treatments).toContain("## Classify the request");
    expect(treatments).toContain("Persist pixel settings with `hyperframes media-treatment`");
    expect(treatments).toContain("do not generate a LUT");
    expect(treatments).toMatch(/Do not run the generic grade\/LUT\s+resolver first/);
    expect(treatments).toContain("apply to the entire selected real `<img>` or");
    expect(treatments).toContain("external segmentation/tracking tool");
  });

  it("keeps vague media feedback bounded and composes optional overlays through Registry", () => {
    const treatments = read("skills", "media-use", "references", "media-treatments.md");

    expect(treatments).toContain("too many shadows and a bit boring");
    expect(treatments).toContain("lift shadows/protect highlights");
    expect(treatments).toContain("retro texture, HUD, or palette effect");
    expect(treatments).toContain("make this reveal cooler");
    expect(treatments).toContain("preserve color and animate one supported effect");
    expect(treatments).toContain("use the focused capability result's `animation`");
    expect(treatments).toMatch(/return temporary treatment\s+values to neutral/);
    expect(treatments).toContain("hyperframes add <name> --dir <project>");
    expect(treatments).toContain("do not make the user discover Catalog");
    expect(treatments).toContain("never duplicate an existing component");
    expect(treatments).toContain("snapshots/treatment-before/contact-sheet.jpg");
    expect(treatments).toContain("do not encode a draft solely to prove a static correction");
    expect(treatments).toMatch(/Do not report visual\s+quality from command success alone/);
  });

  it("documents every deliberately keyframeable treatment control", () => {
    const grading = read("skills", "media-use", "references", "grading.md");

    for (const property of [
      "intensity",
      "lut-intensity",
      "exposure",
      "blur",
      "bloom",
      "kuwahara",
      "pixelate",
      "ascii",
      "dither",
    ]) {
      expect(grading).toContain(`--hf-color-grading-${property}`);
    }
  });

  it("keeps named palette recipes synchronized with Core", () => {
    const recipes = read("skills", "media-use", "references", "media-treatment-recipes.md");

    for (const palette of HF_COLOR_GRADING_PALETTES) {
      expect(recipes).toContain(`\`${palette.id}\``);
      for (const color of palette.colors) expect(recipes).toContain(`\`${color}\``);
    }
  });

  it("routes calibrated shader effects that need agent intent recipes", () => {
    const treatments = read("skills", "media-use", "references", "media-treatments.md");
    const recipes = read("skills", "media-use", "references", "media-treatment-recipes.md");

    for (const heading of [
      "Monochrome Screen Print",
      "Engraved Illustration",
      "Crosshatched Sketch",
      "CRT Display",
    ]) {
      expect(treatments).toContain(`\`${heading}\``);
      expect(recipes).toContain(`## ${heading}`);
    }
  });

  it("teaches agents that recipes are optional seeds for capability-built treatments", () => {
    const skill = read("skills", "media-use", "SKILL.md");
    const treatments = read("skills", "media-use", "references", "media-treatments.md");
    const recipes = read("skills", "media-use", "references", "media-treatment-recipes.md");

    for (const content of [skill, treatments])
      expect(content).toContain("hyperframes media-treatment --capabilities --json");
    expect(recipes).toContain("hyperframes media-treatment --capabilities --json");
    expect(treatments).toContain("--capability <id>");
    expect(treatments).toMatch(/Use\s+`--all` only for/);
    expect(treatments).toContain("Recipes are optional macros");
    expect(recipes).toContain("optional tested seeds");
    expect(treatments).toMatch(/Compose one\s+nested payload/);
  });

  it("places the media-treatment discovery gate in new project instructions", () => {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const template = read("packages", "cli", "src", "templates", "_shared", file);
      expect(template).toContain("Changing how real footage or images look or reveal?");
      expect(template).toContain("Load `/media-use`");
      expect(template).toContain("do not improvise equivalent CSS/SVG filters or overlays");
    }

    const capturedProjectPrompt = read(
      "packages",
      "cli",
      "src",
      "capture",
      "agentPromptGenerator.ts",
    );
    expect(capturedProjectPrompt).toContain("load \\`media-use\\`");
    expect(capturedProjectPrompt).toContain("do not recreate canonical");
  });
});

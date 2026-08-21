// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  it("routes vague composition-media feedback to the canonical workflow", () => {
    const router = read("skills", "hyperframes", "SKILL.md");
    const mediaUse = read("skills", "media-use", "SKILL.md");
    const treatments = read("skills", "media-use", "references", "media-treatments.md");

    expect(router).toContain("dark/flat/boring footage");
    expect(router).toContain("`/media-use`");
    expect(mediaUse).toContain("references/media-treatments.md");
    expect(mediaUse).toContain("`hyperframes media-treatment`");
    expect(treatments).toContain("Persist pixel settings with `hyperframes media-treatment`");
    expect(treatments).toContain("apply to the entire selected real `<img>` or");
    expect(treatments).toContain("external segmentation/tracking tool");
  });

  it("keeps discovery progressive and verification visual", () => {
    const treatments = read("skills", "media-use", "references", "media-treatments.md");
    const recipes = read("skills", "media-use", "references", "media-treatment-recipes.md");

    expect(treatments).toContain("hyperframes media-treatment --capabilities --json");
    expect(treatments).toContain("--capability <id>");
    expect(treatments).toContain("Recipes are optional macros");
    expect(recipes).toContain("optional tested seeds");
    expect(treatments).toContain("hyperframes add <name> --dir <project>");
    expect(treatments).toContain("snapshots/treatment-before/contact-sheet.jpg");
    expect(treatments).toMatch(/Do not report visual\s+quality from command success alone/);
  });

  it("indexes calibrated treatment recipes without making them mandatory", () => {
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

  it("places the media-treatment discovery gate in new project instructions", () => {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const template = read("packages", "cli", "src", "templates", "_shared", file);
      expect(template).toContain("Changing how real footage or images look or reveal?");
      expect(template).toContain("Load `/media-use`");
      expect(template).toContain("do not improvise equivalent CSS/SVG filters or overlays");
    }
  });

  it("gives agents a process-owned preview lifecycle in new project instructions", () => {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const template = read("packages", "cli", "src", "templates", "_shared", file);
      expect(template).toContain("npx hyperframes preview --background");
      expect(template).toContain("npx hyperframes preview --status");
      expect(template).toContain("npx hyperframes preview --stop");
      expect(template).toContain("leaving refreshes at `ERR_CONNECTION_TIMED_OUT`");
      expect(template).not.toContain("run_in_background: true");
    }
  });
});

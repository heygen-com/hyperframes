// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");
describe("hyperframes contract docs", () => {
  it("keeps a runnable root in the format reference's skeleton", () => {
    const minimal = read("skills", "hyperframes", "references", "format.md");

    // Structural pin: the skeleton must still declare a root the runtime can find
    // and size. The prose around it is deliberately not pinned: asserting exact
    // sentences here made every docs correction a CI failure, and the sentence this
    // replaces ("Root <div> with data-composition-id, data-start=\"0\"") listed
    // data-start as required when the runtime stamps it (runtime/init.ts).
    expect(minimal).toMatch(/data-composition-id="main"/);
    expect(minimal).toMatch(/data-width="1920"[\s\S]{0,120}data-height="1080"/);
    expect(minimal).toMatch(/window\.__timelines\["main"\]/);
  });

  it("teaches check as the canonical quality gate", () => {
    const skill = read("skills", "hyperframes", "SKILL.md");

    expect(skill).toContain("`npx hyperframes check --json`");
    expect(skill).not.toContain("`lint` / `validate` / `inspect`");
  });

  it("requires actionable reproduction packets in CLI defect feedback", () => {
    const skill = read("skills", "hyperframes-cli", "references", "feedback.md");
    const renderReference = read("skills", "hyperframes-cli", "references", "preview-render.md");

    expect(read("skills", "hyperframes-cli", "SKILL.md")).toContain("`references/feedback.md`");
    expect(skill).toContain("reproduction packet");
    expect(renderReference).toContain("REPRO COMMAND:");
    expect(renderReference).toContain("EXPECTED / ACTUAL:");
    expect(renderReference).toContain("EXACT ERROR:");
    expect(renderReference).toContain("OUTCOME:");
    expect(renderReference).toContain("WORKAROUND:");
  });

  it("sends missing features and host-app friction as ratingless comments", () => {
    const skill = read("skills", "hyperframes-cli", "references", "feedback.md");

    expect(skill).toContain(
      'npx hyperframes feedback --comment "MISSING FEATURE: <what the person asked for, in their words, with names, clients, figures and paths left out> | WORKAROUND:',
    );
    expect(skill).toMatch(/HYPERFRAMES_CLIENT[^\n]*npx hyperframes feedback --comment "HOST APP:/);
  });

  it("mandates a composition-structure block for visual-defect feedback", () => {
    const skill = read("skills", "hyperframes-cli", "references", "feedback.md");
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
    const skill = read("skills", "hyperframes-cli", "references", "conventions.md");
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

    expect(router).toContain("`npx hyperframes media-treatment` (`/media-use`), never CSS filters");
    expect(mediaUse).toContain("footage is dark, flat or dull");
    expect(mediaUse).toContain("references/media-treatments.md");
    expect(mediaUse).toContain("`npx hyperframes media-treatment`");
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

  it("routes every skill that builds visuals through the live catalog search", () => {
    // The search instruction once lived only in hyperframes-cli and
    // hyperframes-registry, both loaded on demand, so an agent that never thought
    // to search could not reach the doc telling it to search.
    for (const file of [
      ["skills", "slideshow", "SKILL.md"],
      ["skills", "remotion-to-hyperframes", "SKILL.md"],
    ]) {
      const doc = read(...file);
      expect(doc, file.join("/")).toContain("npx hyperframes catalog --query");
      // "I forgot to install the components" was the wrong self-diagnosis that
      // hid this bug. Every copy of the instruction has to kill it on the spot.
      expect(doc, file.join("/")).toContain("nothing installed");
    }
    expect(read("skills", "hyperframes", "SKILL.md")).toContain(
      "search the registry (`/hyperframes-registry`)",
    );

    // The symptom-triggered description is the other half of the fix: the skill
    // has to be reachable from the user naming an effect, not from the command.
    const registrySkill = read("skills", "hyperframes-registry", "SKILL.md");
    expect(registrySkill).toContain("Use it before hand-building any named visual");
    expect(registrySkill).toContain("CRT scanlines");
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

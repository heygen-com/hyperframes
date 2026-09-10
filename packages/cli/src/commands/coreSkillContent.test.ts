// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");
const skillTextFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|mjs|cjs|js|ts|json|html)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));

describe("hyperframes-core contract docs", () => {
  it("keeps a runnable root in the minimal composition skeleton", () => {
    const minimal = read("skills", "hyperframes-core", "references", "minimal-composition.md");

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

  it("makes the motion-graphics build path run a live catalog search, not read a snapshot", () => {
    // The failure this pins: a user inside /motion-graphics asked for "CRT scanlines
    // and glitch effects" and the agent hand-authored both, while `caption-glitch-rgb`
    // ("RGB chromatic aberration with CRT scanline overlay") ranks first for that exact
    // query on either tier. Every reuse instruction in the workflow pointed at
    // catalog-map.md, a hand-maintained snapshot, and none named the search. The search
    // needs nothing installed, so "I forgot to install the components" was never the cause.
    for (const file of [
      ["skills", "motion-graphics", "catalog-map.md"],
      ["skills", "motion-graphics", "agents", "director.md"],
      ["skills", "motion-graphics", "agents", "builder.md"],
    ]) {
      expect(read(...file)).toContain("npx hyperframes catalog --query");
    }
    // And it must say the search stands alone, or the next reader re-derives the
    // creator's wrong diagnosis: that a catalog you have not installed cannot be searched.
    expect(read("skills", "motion-graphics", "catalog-map.md")).toContain(
      "needs nothing installed",
    );
  });

  it("routes every authoring workflow through the live catalog search, or documents why not", () => {
    // The same failure one layer up. The search instruction lived only in
    // hyperframes-cli and hyperframes-registry, both loaded on demand, and the
    // registry skill's own trigger named the command ("use when running
    // hyperframes catalog") — circular, because the agent that never thought to
    // search could not reach the doc telling it to search. All ten workflow
    // skills carried zero mentions of the command.
    for (const file of [
      ["skills", "motion-graphics", "agents", "director.md"],
      ["skills", "product-launch-video", "SKILL.md"],
      ["skills", "faceless-explainer", "SKILL.md"],
      ["skills", "pr-to-video", "SKILL.md"],
      ["skills", "music-to-video", "SKILL.md"],
      ["skills", "general-video", "SKILL.md"],
      ["skills", "slideshow", "SKILL.md"],
      ["skills", "remotion-to-hyperframes", "SKILL.md"],
    ]) {
      const doc = read(...file);
      expect(doc, file.join("/")).toContain("npx hyperframes catalog --query");
      // "I forgot to install the components" was the wrong self-diagnosis that
      // hid this bug. Every copy of the instruction has to kill it on the spot.
      expect(doc, file.join("/")).toContain("nothing installed");
    }

    // The two workflows that deliberately do NOT search. Both compile their
    // output through a closed authoring vocabulary (embedded-captions' locked
    // caption engines, talking-head-recut's `data-anim` card kinds), and a
    // registry item is a standalone composition with no place to mount. The
    // exemption is written into each skill so the next reader does not close
    // the gap with an instruction that would be false there.
    for (const skill of ["embedded-captions", "talking-head-recut"]) {
      expect(read("skills", skill, "SKILL.md"), skill).toContain(
        "does not search the HyperFrames component registry",
      );
      // The exemption is a capability claim, so pin the capability and not only
      // the sentence: the day either skill gains a way to install a registry item,
      // this fails and the exemption has to be reconsidered. `data-composition-src`
      // is deliberately not the signal; talking-head-recut mounts its own chapters
      // with it, which is not a registry item.
      for (const file of skillTextFiles(join(REPO_ROOT, "skills", skill))) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(
          /hyperframes add\b|registry\/(blocks|components)\//,
        );
      }
    }

    // The symptom-triggered description is the other half of the fix: the skill
    // has to be reachable from the user naming an effect, not from the command.
    const registrySkill = read("skills", "hyperframes-registry", "SKILL.md");
    expect(registrySkill).toContain("Use BEFORE hand-building any named visual");
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

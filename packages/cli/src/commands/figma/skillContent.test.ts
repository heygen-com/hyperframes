// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Semantic pin for the /figma skill's telemetry instructions: the MCP-only
// phases (motion/shaders/storyboards) have NO CLI touchpoint, so the beacon
// wording in SKILL.md is the only thing that produces their usage signal. The
// manifest hash proves the skill changed; this proves a future prompt edit
// didn't silently drop the beacon slugs or the completion event.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");
const SKILL_MD = read("skills", "figma", "SKILL.md");

describe("figma SKILL.md telemetry beacons", () => {
  it("instructs the beacon for every MCP-only phase", () => {
    expect(SKILL_MD).toContain("figma-motion");
    expect(SKILL_MD).toContain("figma-shaders");
    expect(SKILL_MD).toContain("figma-storyboard");
    expect(SKILL_MD).toContain("hyperframes events");
  });

  it("instructs the completion beacon with an outcome", () => {
    expect(SKILL_MD).toContain("--event=skill_completed");
    expect(SKILL_MD).toMatch(/--outcome=success\|error/);
  });
});

// Routing pin: the catalog blurb once said "storyboard sections → animatics",
// which encodes the frames-as-pictures slideshow the skill's own cardinal rule
// forbids — a field agent routed by that word and concluded the shipped
// behavior was the PNG-sequence architecture. These assertions keep the
// frames-are-states framing on every discovery surface and keep the doctrine
// in the skill body, so a future sync can't silently reintroduce the old word.
describe("figma storyboard doctrine pins", () => {
  const CATALOG_SURFACES: Array<[string, string[]]> = [
    ["skills/figma/SKILL.md", ["skills", "figma", "SKILL.md"]],
    ["CLAUDE.md", ["CLAUDE.md"]],
    ["README.md", ["README.md"]],
    ["docs/guides/skills.mdx", ["docs", "guides", "skills.mdx"]],
    ["skills/hyperframes/SKILL.md", ["skills", "hyperframes", "SKILL.md"]],
  ];

  it("every catalog surface says reconstructed motion, never animatics", () => {
    for (const [label, parts] of CATALOG_SURFACES) {
      const content = read(...parts);
      expect(content, label).toContain("reconstructed motion");
      expect(content, label).not.toContain("animatics");
    }
  });

  it("the source-of-truth description carries the frames-as-states framing", () => {
    expect(SKILL_MD).toContain("frames read as states, not slides");
  });

  it("keeps the cardinal rule and the app-states escalation (rule 10)", () => {
    expect(SKILL_MD).toContain("KEYFRAMES, not slides");
    expect(SKILL_MD).toContain("code what changes state, freeze what doesn't");
    expect(SKILL_MD).toContain("interaction to perform");
  });
});

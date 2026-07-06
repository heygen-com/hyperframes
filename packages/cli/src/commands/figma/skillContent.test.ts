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
const SKILL_MD = readFileSync(
  join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "..",
    "skills",
    "figma",
    "SKILL.md",
  ),
  "utf8",
);

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

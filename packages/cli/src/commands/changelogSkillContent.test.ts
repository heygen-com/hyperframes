// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");

describe("changelog-video layout contract", () => {
  const buildSpec = read(".claude", "skills", "changelog-video", "references", "build-spec.md");
  const skill = read(".claude", "skills", "changelog-video", "SKILL.md");
  const skeleton = read(".claude", "skills", "changelog-video", "examples", "master-skeleton.html");

  it("keeps overlap waivers local instead of disabling a whole slide audit", () => {
    expect(buildSpec).not.toMatch(/data-layout-allow-overlap` on\s+the slide root/);
    expect(buildSpec).toContain("never on the slide root");
    expect(skeleton).not.toMatch(/class="slide[^"]*"[^>]*data-layout-allow-overlap/);
  });

  it("checks scene content against the caption rail while exempting the rail itself", () => {
    expect(skill).toContain(
      '--caption-zone "x0=0;y0=.90;x1=1;y1=1;severity=error;seek=.05,.15,.25,.35,.45,.55,.65,.75,.85,.95"',
    );
    expect(skeleton).toMatch(/id="cap-line"[^>]*data-layout-allow-caption-zone/);
  });
});

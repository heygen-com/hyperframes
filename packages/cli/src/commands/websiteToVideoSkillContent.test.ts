// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");

describe("website-to-video public install guidance", () => {
  it("sources the HyperShader browser bundle from the published package", () => {
    const build = read("skills", "website-to-video", "references", "step-5-build.md");

    expect(build).toContain("@hyperframes/shader-transitions");
    expect(build).toContain("node_modules/@hyperframes/shader-transitions/dist/index.global.js");
    expect(build).not.toContain("cp packages/shader-transitions/dist/index.global.js");
  });

  it("does not present registry showcase blocks as the reusable HyperShader runtime", () => {
    const storyboard = read("skills", "website-to-video", "references", "step-3-storyboard.md");

    expect(storyboard).toContain("showcase blocks are standalone demos");
    expect(storyboard).not.toContain("find the actual shader name used in `HyperShader.init()`");
  });
});

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInside } from "./assetPaths.js";
import { isWithinProjectRoot, resolveLocalAssetCandidates } from "./assetResolution.js";

describe("asset path containment", () => {
  const root = resolve("project");

  it.each(["..intro.mp4", "..assets/clip.mp4", ".../clip.mp4"])(
    "accepts an in-project path named %s",
    (name) => {
      const candidate = resolve(root, name);
      expect(isPathInside(candidate, root)).toBe(true);
      expect(isWithinProjectRoot(root, candidate)).toBe(true);
      expect(resolveLocalAssetCandidates(root, name)).toEqual([candidate]);
    },
  );

  it.each(["..", "../outside.mp4", "../project-sibling/clip.mp4"])(
    "rejects a path outside the project: %s",
    (name) => {
      const candidate = resolve(root, name);
      expect(isPathInside(candidate, root)).toBe(false);
      expect(isWithinProjectRoot(root, candidate)).toBe(false);
    },
  );

  it("keeps the existing project-root clamping for dot-prefixed asset names", () => {
    expect(resolveLocalAssetCandidates(root, "../..assets/clip.mp4")).toEqual([
      resolve(root, "..assets/clip.mp4"),
    ]);
  });

  it("accepts the project root itself", () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(isWithinProjectRoot(root, root)).toBe(true);
  });
});

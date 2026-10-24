import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isPathInside } from "./assetPaths.js";

describe("isPathInside", () => {
  it("accepts the parent itself and nested children", () => {
    expect(isPathInside(resolve("/project"), resolve("/project"))).toBe(true);
    expect(isPathInside(resolve("/project/assets/logo.png"), resolve("/project"))).toBe(true);
  });

  it("rejects paths above the parent and siblings sharing its prefix", () => {
    expect(isPathInside(resolve("/project/../secret.txt"), resolve("/project"))).toBe(false);
    expect(isPathInside(resolve("/"), resolve("/project"))).toBe(false);
    expect(isPathInside(resolve("/project-other/logo.png"), resolve("/project"))).toBe(false);
  });

  it("accepts a child whose name starts with two dots", () => {
    // `..assets` is an ordinary directory name, not a parent-dir segment.
    expect(isPathInside(resolve("/project/..assets/logo.png"), resolve("/project"))).toBe(true);
    expect(isPathInside(resolve("/project/..intro.mp4"), resolve("/project"))).toBe(true);
  });
});

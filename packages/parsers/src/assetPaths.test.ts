import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isNonRelativeUrl, isPathInside } from "./assetPaths.js";

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

describe("isNonRelativeUrl", () => {
  it("treats any URL with a scheme as non-relative", () => {
    for (const url of [
      "mailto:hello@example.com",
      "tel:+15551234567",
      "blob:https://example.com/0f6f1a7e",
      "about:blank",
      "javascript:void(0)",
      "HTTPS://cdn.example.com/logo.png",
      "Data:image/png;base64,AAAA",
    ]) {
      expect(isNonRelativeUrl(url), url).toBe(true);
    }
  });

  it("keeps relative paths and Windows drive letters relative", () => {
    for (const url of [
      "assets/logo.png",
      "../logo.png",
      "./a:b.png",
      "logo.png?v=1",
      "C:/media/x.mp4",
    ]) {
      expect(isNonRelativeUrl(url), url).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { isCompositionFolder, isHyperframesProject } from "./projectRule";

describe("isHyperframesProject", () => {
  it.each(["hyperframes.json", "meta.json", "project.json"])(
    "counts a folder with index.html and %s",
    (marker) => {
      expect(isHyperframesProject(["index.html", marker, "assets"])).toBe(true);
    },
  );

  it("does not count index.html alone, or a marker without index.html", () => {
    expect(isHyperframesProject(["index.html", "package.json"])).toBe(false);
    expect(isHyperframesProject(["hyperframes.json", "README.md"])).toBe(false);
  });
});

// fails without the fix: a step had only the discovery rule, so a folder holding a composition but no marker file was
// refused by `open` though `snapshot` and `check` worked on it.
describe("isCompositionFolder", () => {
  it("counts any folder with index.html, marker or not", () => {
    expect(isCompositionFolder(["index.html"])).toBe(true);
    expect(isCompositionFolder(["index.html", "hyperframes.json"])).toBe(true);
  });

  it("does not count a folder without index.html", () => {
    expect(isCompositionFolder(["hyperframes.json", "assets"])).toBe(false);
  });
});

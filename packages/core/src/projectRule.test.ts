import { describe, expect, it } from "vitest";
import { isHyperframesProject } from "./projectRule";

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

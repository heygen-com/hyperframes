import { describe, expect, it } from "vitest";
import { checkProvenanceTags } from "./provenance.js";

describe("checkProvenanceTags", () => {
  it("warns when a -port tag has no recorded source", () => {
    const finding = checkProvenanceTags({
      tags: ["remocn-port", "data"],
    });

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("remocn-port");
  });

  it("does not warn when a -port tag has sourceUrl", () => {
    const finding = checkProvenanceTags({
      tags: ["remocn-port"],
      sourceUrl: "https://example.com/source",
    });

    expect(finding).toBeNull();
  });

  it("does not warn when a -port tag has sourcePrompt", () => {
    const finding = checkProvenanceTags({
      tags: ["remocn-port"],
      sourcePrompt: "Port the source component faithfully.",
    });

    expect(finding).toBeNull();
  });

  it("does not warn when no tag ends in -port", () => {
    const finding = checkProvenanceTags({
      tags: ["data", "chart"],
    });

    expect(finding).toBeNull();
  });
});

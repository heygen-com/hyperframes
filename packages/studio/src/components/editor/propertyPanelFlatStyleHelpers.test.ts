import { describe, expect, it } from "vitest";
import { formatStrokeSummary, parseStrokeSummary } from "./propertyPanelFlatStyleHelpers";

describe("formatStrokeSummary", () => {
  it("formats width and style into one string", () => {
    expect(formatStrokeSummary(1, "solid")).toBe("1px solid");
    expect(formatStrokeSummary(2.5, "dashed")).toBe("2.5px dashed");
    expect(formatStrokeSummary(0, "none")).toBe("0px none");
  });
});

describe("parseStrokeSummary", () => {
  it("parses a well-formed summary back into width and style", () => {
    expect(parseStrokeSummary("1px solid")).toEqual({ widthPx: 1, style: "solid" });
    expect(parseStrokeSummary("  2.5px   dashed  ")).toEqual({ widthPx: 2.5, style: "dashed" });
  });

  it("returns null for unparseable input", () => {
    expect(parseStrokeSummary("garbage")).toBeNull();
    expect(parseStrokeSummary("")).toBeNull();
    expect(parseStrokeSummary("1px")).toBeNull();
  });
});

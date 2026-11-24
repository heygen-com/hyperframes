import { describe, expect, it } from "vitest";
import { chooseTier } from "./tier";

const defect = { code: "root-opacity", reason: "why" };
const base = { tier: "auto", form: true, defect: null, fallback: true } as const;

describe("chooseTier", () => {
  it("draws with the filter tier on auto", () => {
    expect(chooseTier({ ...base, tier: "auto", form: true, defect: null, fallback: true })).toBe(
      "filter",
    );
  });

  it("draws with capture only when the page asks", () => {
    expect(chooseTier({ ...base, tier: "capture" })).toBe("capture");
  });

  it("judges capture alone when the fallback is off", () => {
    expect(chooseTier({ ...base, tier: "auto", fallback: false })).toBe("capture");
  });

  it("draws with the filter tier where capture cannot run, even when asked for", () => {
    expect(chooseTier({ ...base, tier: "capture", defect })).toBe("filter");
    expect(chooseTier({ ...base, tier: "capture", form: false })).toBe("filter");
  });

  it("draws with the filter tier when the page asks for it", () => {
    expect(chooseTier({ ...base, tier: "filter" })).toBe("filter");
  });

  it("stays off where the renderer said so, whatever the tier", () => {
    const renderer = { code: "renderer-off", reason: "hdr-render" };
    for (const tier of ["auto", "capture", "filter"] as const) {
      expect(chooseTier({ ...base, tier, defect: renderer })).toBe("off");
    }
  });

  it("is off, not filter, when the fallback is not allowed", () => {
    expect(chooseTier({ ...base, defect, fallback: false })).toBe("off");
    expect(chooseTier({ ...base, tier: "filter", fallback: false })).toBe("capture");
    expect(chooseTier({ ...base, form: false, fallback: false })).toBe("off");
  });
});

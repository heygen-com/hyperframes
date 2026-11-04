import { describe, expect, it } from "vitest";
import { chooseTier } from "./tier";

const defect = { code: "root-opacity", reason: "why" };
const base = { tier: "auto", form: true, defect: null, fallback: true } as const;

describe("chooseTier", () => {
  it("draws with capture where it can run", () => {
    expect(chooseTier(base)).toBe("capture");
    expect(chooseTier({ ...base, tier: "capture" })).toBe("capture");
  });

  it("draws with the filter tier where capture cannot run", () => {
    expect(chooseTier({ ...base, defect })).toBe("filter");
    expect(chooseTier({ ...base, form: false })).toBe("filter");
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

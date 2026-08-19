import { describe, expect, it } from "vitest";
import { buildPadToDurationFilter } from "./audioPadFilter.js";

describe("buildPadToDurationFilter", () => {
  it("pads indefinitely, rebuilds timestamps, then bounds at the target", () => {
    expect(buildPadToDurationFilter("43.3")).toBe("apad,asetpts=N/SR/TB,atrim=0:43.3");
  });

  it("keeps off `whole_dur`, which the bundled Windows FFmpeg builds reject", () => {
    expect(buildPadToDurationFilter("5.000000")).not.toContain("whole_dur");
  });

  it("uses the caller's number formatting verbatim", () => {
    // Each call site formats seconds differently (fixed-6 in the producer,
    // trimmed in the mixer). The helper must not normalize either away.
    expect(buildPadToDurationFilter("5.000000")).toContain("atrim=0:5.000000");
    expect(buildPadToDurationFilter("5")).toContain("atrim=0:5");
  });

  it("places asetpts between apad and atrim, which is the whole fix", () => {
    // `atrim` reading an indefinite `apad`'s timestamps directly is what drops
    // and misplaces mixed clips on FFmpeg 7+. Order is the behaviour here, so
    // pin it rather than only pinning membership.
    const chain = buildPadToDurationFilter("8").split(",");
    expect(chain).toEqual(["apad", "asetpts=N/SR/TB", "atrim=0:8"]);
  });
});

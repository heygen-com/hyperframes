import { describe, expect, it } from "vitest";
import { hdrToSdrToneMapFilter } from "./hdrToneMap";

const PQ = { colorSpace: "bt2020nc", colorPrimaries: "bt2020", colorTransfer: "smpte2084" };
const TONE_MAP =
  "zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv";

describe("hdrToSdrToneMapFilter", () => {
  it("leaves every frame its own tags when the first frame carries them all", () => {
    expect(hdrToSdrToneMapFilter(PQ, PQ)).toBe(TONE_MAP);
  });

  it("sets the probed tags the first frame lacks", () => {
    expect(hdrToSdrToneMapFilter(PQ, {})).toBe(
      `setparams=colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084,${TONE_MAP}`,
    );
    expect(hdrToSdrToneMapFilter(PQ, { colorTransfer: "arib-std-b67" })).toBe(
      `setparams=colorspace=bt2020nc:color_primaries=bt2020,${TONE_MAP}`,
    );
  });

  it("treats a missing matrix or primaries as BT.2020 and leaves an unknown transfer to the frames", () => {
    expect(
      hdrToSdrToneMapFilter(
        { colorSpace: "unknown", colorTransfer: "arib-std-b67" },
        { colorSpace: "unknown", colorPrimaries: "unknown", colorTransfer: "arib-std-b67" },
      ),
    ).toBe(`setparams=colorspace=bt2020nc:color_primaries=bt2020,${TONE_MAP}`);
    expect(hdrToSdrToneMapFilter({ colorPrimaries: "reserved" }, {})).toBe(
      `setparams=colorspace=bt2020nc:color_primaries=bt2020,${TONE_MAP}`,
    );
  });
});

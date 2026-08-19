import { describe, expect, it } from "vitest";
import {
  isHdrColorSpace,
  detectTransfer,
  getHdrEncoderColorParams,
  analyzeCompositionHdr,
  DEFAULT_HDR10_MASTERING,
} from "./hdr.js";
import type { VideoColorSpace } from "./ffprobe.js";

describe("isHdrColorSpace", () => {
  it("returns false for null", () => {
    expect(isHdrColorSpace(null)).toBe(false);
  });

  it("returns false for bt709 SDR", () => {
    expect(
      isHdrColorSpace({ colorTransfer: "bt709", colorPrimaries: "bt709", colorSpace: "bt709" }),
    ).toBe(false);
  });

  it("does not treat SDR transfer in a BT.2020 gamut as HDR", () => {
    expect(
      isHdrColorSpace({ colorTransfer: "bt709", colorPrimaries: "bt2020", colorSpace: "bt709" }),
    ).toBe(false);
  });

  it("detects smpte2084 (PQ)", () => {
    expect(
      isHdrColorSpace({
        colorTransfer: "smpte2084",
        colorPrimaries: "bt2020",
        colorSpace: "bt2020nc",
      }),
    ).toBe(true);
  });

  it("detects arib-std-b67 (HLG)", () => {
    expect(
      isHdrColorSpace({
        colorTransfer: "arib-std-b67",
        colorPrimaries: "bt2020",
        colorSpace: "bt2020nc",
      }),
    ).toBe(true);
  });
});

describe("detectTransfer", () => {
  it("returns hlg for null", () => {
    expect(detectTransfer(null)).toBe("hlg");
  });

  it("returns pq for smpte2084", () => {
    expect(
      detectTransfer({
        colorTransfer: "smpte2084",
        colorPrimaries: "bt2020",
        colorSpace: "bt2020nc",
      }),
    ).toBe("pq");
  });

  it("returns hlg for arib-std-b67", () => {
    expect(
      detectTransfer({
        colorTransfer: "arib-std-b67",
        colorPrimaries: "bt2020",
        colorSpace: "bt2020nc",
      }),
    ).toBe("hlg");
  });

  it("returns hlg for bt709 (fallback)", () => {
    expect(
      detectTransfer({ colorTransfer: "bt709", colorPrimaries: "bt709", colorSpace: "bt709" }),
    ).toBe("hlg");
  });
});

describe("getHdrEncoderColorParams", () => {
  it("returns PQ params with mastering metadata", () => {
    const params = getHdrEncoderColorParams("pq");
    expect(params.colorTrc).toBe("smpte2084");
    expect(params.colorPrimaries).toBe("bt2020");
    expect(params.colorspace).toBe("bt2020nc");
    expect(params.pixelFormat).toBe("yuv420p10le");
    expect(params.x265ColorParams).toContain("colorprim=bt2020");
    expect(params.x265ColorParams).toContain("transfer=smpte2084");
    expect(params.x265ColorParams).toContain("colormatrix=bt2020nc");
    expect(params.mastering).toEqual(DEFAULT_HDR10_MASTERING);
  });

  it("returns HLG params with mastering metadata", () => {
    const params = getHdrEncoderColorParams("hlg");
    expect(params.colorTrc).toBe("arib-std-b67");
    expect(params.colorPrimaries).toBe("bt2020");
    expect(params.pixelFormat).toBe("yuv420p10le");
    expect(params.x265ColorParams).toContain("transfer=arib-std-b67");
    expect(params.mastering).toEqual(DEFAULT_HDR10_MASTERING);
  });

  // Regression guard for the side_data=[none] bug. See
  // packages/producer/scripts/hdr-smoke.ts and the bug-1 entry in
  // hdr-deferred-followups.md. Without master-display + max-cll in the
  // x265-params, downstream players (Apple QuickTime, YouTube, HDR TVs) treat
  // the file as SDR BT.2020 and tone-map incorrectly.
  it("emits master-display and max-cll for PQ", () => {
    const params = getHdrEncoderColorParams("pq");
    expect(params.x265ColorParams).toContain(
      `master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`,
    );
    expect(params.x265ColorParams).toContain(`max-cll=${DEFAULT_HDR10_MASTERING.maxCll}`);
  });

  it("emits master-display and max-cll for HLG", () => {
    const params = getHdrEncoderColorParams("hlg");
    expect(params.x265ColorParams).toContain(
      `master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`,
    );
    expect(params.x265ColorParams).toContain(`max-cll=${DEFAULT_HDR10_MASTERING.maxCll}`);
  });

  it("respects an explicit mastering override", () => {
    const custom = {
      masterDisplay: "G(1,2)B(3,4)R(5,6)WP(7,8)L(9,10)",
      maxCll: "500,200",
    };
    const params = getHdrEncoderColorParams("pq", custom);
    expect(params.mastering).toBe(custom);
    expect(params.x265ColorParams).toContain("master-display=G(1,2)B(3,4)R(5,6)WP(7,8)L(9,10)");
    expect(params.x265ColorParams).toContain("max-cll=500,200");
  });

  // The DEFAULT_HDR10_MASTERING values are tagged as "P3-D65 inside BT.2020,
  // 0.0001-1000 nits, MaxCLL 1000 / MaxFALL 400". If anyone tweaks these
  // numbers without updating the docstring or the deferred-followups doc,
  // this test will fail and force a deliberate review.
  it("DEFAULT_HDR10_MASTERING matches the documented HDR10 reference", () => {
    expect(DEFAULT_HDR10_MASTERING.masterDisplay).toBe(
      "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)",
    );
    expect(DEFAULT_HDR10_MASTERING.maxCll).toBe("1000,400");
  });
});

describe("analyzeCompositionHdr", () => {
  const sdr: VideoColorSpace = {
    colorTransfer: "bt709",
    colorPrimaries: "bt709",
    colorSpace: "bt709",
  };
  const hlg: VideoColorSpace = {
    colorTransfer: "arib-std-b67",
    colorPrimaries: "bt2020",
    colorSpace: "bt2020nc",
  };
  const pq: VideoColorSpace = {
    colorTransfer: "smpte2084",
    colorPrimaries: "bt2020",
    colorSpace: "bt2020nc",
  };

  it("returns no HDR for all SDR", () => {
    expect(analyzeCompositionHdr([sdr, sdr, null])).toEqual({
      hasHdr: false,
      dominantTransfer: null,
    });
  });

  it("detects HLG", () => {
    expect(analyzeCompositionHdr([sdr, hlg])).toEqual({
      hasHdr: true,
      dominantTransfer: "hlg",
    });
  });

  it("detects PQ", () => {
    expect(analyzeCompositionHdr([sdr, pq])).toEqual({
      hasHdr: true,
      dominantTransfer: "pq",
    });
  });

  it("PQ takes priority over HLG in mixed HDR", () => {
    expect(analyzeCompositionHdr([hlg, pq])).toEqual({
      hasHdr: true,
      dominantTransfer: "pq",
    });
  });
});

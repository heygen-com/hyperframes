import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  hdrToSdrToneMapFilter,
  keyframeTransferArgs,
  parseKeyframeTransfers,
  toneMapReferenceNits,
} from "./hdrToneMap";

const PQ = { colorSpace: "bt2020nc", colorPrimaries: "bt2020", colorTransfer: "smpte2084" };
const toneMap = (npl: number) =>
  `zscale=t=linear:npl=${npl},tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv`;

describe("hdrToSdrToneMapFilter", () => {
  it("leaves every frame its own tags when the first frame carries them all", () => {
    expect(hdrToSdrToneMapFilter(PQ, PQ)).toBe(toneMap(100));
  });

  it("resizes in the first zscale, before the tone map, when it is given a size", () => {
    expect(hdrToSdrToneMapFilter(PQ, PQ, { width: "1920", height: "1080" })).toBe(
      "zscale=w=1920:h=1080:t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv",
    );
  });

  it("sets the probed tags the first frame lacks", () => {
    expect(hdrToSdrToneMapFilter(PQ, {})).toBe(
      `setparams=colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084,${toneMap(100)}`,
    );
    expect(hdrToSdrToneMapFilter(PQ, { colorTransfer: "arib-std-b67" })).toBe(
      `setparams=colorspace=bt2020nc:color_primaries=bt2020,${toneMap(100)}`,
    );
  });

  it("treats a missing matrix or primaries as BT.2020 and leaves an unknown transfer to the frames", () => {
    expect(
      hdrToSdrToneMapFilter(
        { colorSpace: "unknown", colorTransfer: "arib-std-b67" },
        { colorSpace: "unknown", colorPrimaries: "unknown", colorTransfer: "arib-std-b67" },
      ),
    ).toBe(`setparams=colorspace=bt2020nc:color_primaries=bt2020,${toneMap(100)}`);
    expect(hdrToSdrToneMapFilter({ colorPrimaries: "reserved" }, {})).toBe(
      `setparams=colorspace=bt2020nc:color_primaries=bt2020,${toneMap(100)}`,
    );
  });

  it("maps a stream at BT.2408's 203-nit HLG reference white only when every keyframe is HLG", () => {
    const hlg = { ...PQ, colorTransfer: "arib-std-b67" };
    const keyframes = (...keyframeTransfers: string[]) => ({ ...hlg, keyframeTransfers });
    expect(hdrToSdrToneMapFilter(hlg, keyframes("arib-std-b67", "arib-std-b67"))).toBe(
      toneMap(203),
    );
    expect(hdrToSdrToneMapFilter(hlg, keyframes("arib-std-b67", "smpte2084"))).toBe(toneMap(100));
    expect(hdrToSdrToneMapFilter(hlg, keyframes("arib-std-b67", "bt709"))).toBe(toneMap(100));
    expect(hdrToSdrToneMapFilter(hlg, keyframes())).toBe(toneMap(100));
    const untagged = (keyframeTransfers: string[]) => ({
      colorTransfer: "unknown",
      keyframeTransfers,
    });
    expect(hdrToSdrToneMapFilter(hlg, untagged(["unspecified", "arib-std-b67"]))).toContain(
      "npl=203",
    );
    expect(hdrToSdrToneMapFilter(PQ, untagged(["unspecified"]))).toContain("npl=100");
    expect(hdrToSdrToneMapFilter(PQ, { ...PQ, keyframeTransfers: ["smpte2084"] })).toBe(
      toneMap(100),
    );
    expect(toneMapReferenceNits(undefined)).toBe(100);
  });

  it("names each SPS transfer trace_headers prints, and reads only keyframes' headers", () => {
    const line = (code: number) =>
      `[trace_headers @ 0x1] 287         transfer_characteristics       00010010 = ${code}`;
    expect(parseKeyframeTransfers([18, 16, 1, 2, 4].map(line).join("\n"))).toEqual([
      "arib-std-b67",
      "smpte2084",
      "bt709",
      "unspecified",
      "code 4",
    ]);
    expect(keyframeTransferArgs("clip.mov", "hevc")).toContain(
      "filter_units=pass_types=33,trace_headers",
    );
    expect(keyframeTransferArgs("clip.mov")).toEqual(expect.arrayContaining(["-discard", "nokey"]));
  });
});

const FFMPEG_MAJOR = Number(
  /ffmpeg version n?(\d+)/.exec(spawnSync("ffmpeg", ["-version"]).stdout?.toString() ?? "")?.[1] ??
    0,
);
const HAS_ZSCALE = /\szscale\s/.test(
  spawnSync("ffmpeg", ["-hide_banner", "-filters"]).stdout?.toString() ?? "",
);

/** The 8-bit full-range grey the chain makes of one 10-bit HLG code value. */
function toneMappedGrey(code: number): number {
  const hlg = { colorSpace: "bt2020nc", colorPrimaries: "bt2020", colorTransfer: "arib-std-b67" };
  const tags =
    "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv";
  const run = spawnSync("ffmpeg", [
    ...["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.04"],
    ...[
      "-vf",
      `format=yuv420p10le,geq=lum=${code}:cb=512:cr=512,${tags},${hdrToSdrToneMapFilter(hlg, { ...hlg, keyframeTransfers: ["arib-std-b67"] })}`,
    ],
    ...["-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
  ]);
  const luma = run.stdout[0] ?? Number.NaN;
  return Math.round(((luma - 16) * 255) / 219);
}

// ffmpeg before 8 bundles an older zimg that maps HLG white near 174, outside the tolerance.
describe.skipIf(!HAS_ZSCALE || FFMPEG_MAJOR < 8)("hdrToSdrToneMapFilter on HLG grey", () => {
  // Apple's own SDR conversion (avconvert) of these 10-bit steps gives 105 and 161; at 100 nits ours gave 142 and 216.
  it("puts mid grey and reference white where Apple's SDR conversion does", () => {
    expect(Math.abs(toneMappedGrey(551) - 105)).toBeLessThanOrEqual(8);
    expect(Math.abs(toneMappedGrey(745) - 161)).toBeLessThanOrEqual(8);
  });
});

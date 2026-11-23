import { describe, expect, it } from "bun:test";
import { getSrgbToSignalLut } from "@hyperframes/engine";
import {
  buildBlendCheckArgs,
  buildBlendCheckSamples,
  compareBlendOutput,
} from "./ffmpegBlendCheck.js";
import { buildBlendFilters } from "./ffmpegComposite.js";

/**
 * The blend a 1-LSB-off `maskedmerge` gives (ffmpeg 4.2's: `(a * o + (max - a) * v + half) / max`
 * in integers, which rounds the 16-bit mask's alpha differently from `a8 / 255`).
 */
function integerBlend(samples: ReturnType<typeof buildBlendCheckSamples>): Buffer {
  const out = Buffer.alloc(samples.expected.length);
  const pixels = samples.width * samples.height;
  for (let i = 0; i < pixels; i++) {
    const a = samples.overlay.readUInt16LE(i * 8 + 6);
    for (let c = 0; c < 3; c++) {
      const o = samples.overlay.readUInt16LE(i * 8 + c * 2);
      const v = samples.video.readUInt16LE(i * 6 + c * 2);
      out.writeUInt16LE(Math.floor((o * a + v * (65535 - a) + 32768) / 65536), i * 6 + c * 2);
    }
  }
  return out;
}

describe("buildBlendCheckSamples", () => {
  it("covers every 8-bit alpha with the overlay in the composite's 16-bit format", () => {
    const samples = buildBlendCheckSamples();
    const lut = getSrgbToSignalLut("hlg");
    const alphas = new Set<number>();
    for (let i = 0; i < samples.width * samples.height; i++) {
      const a16 = samples.overlay.readUInt16LE(i * 8 + 6);
      expect(a16 % 257).toBe(0);
      alphas.add(a16 / 257);
      for (let c = 0; c < 3; c++) {
        expect(lut).toContain(samples.overlay.readUInt16LE(i * 8 + c * 2));
      }
    }
    expect(alphas.size).toBe(256);
    // Transparent pixels keep the video, opaque ones take the overlay.
    const transparent = 2 * samples.width;
    expect(samples.expected.readUInt16LE(transparent * 6)).toBe(
      samples.video.readUInt16LE(transparent * 6),
    );
    const opaque = 255;
    expect(samples.expected.readUInt16LE(opaque * 6)).toBe(
      samples.overlay.readUInt16LE(opaque * 8),
    );
  });

  it("is the same on every call", () => {
    expect(buildBlendCheckSamples().expected.equals(buildBlendCheckSamples().expected)).toBe(true);
  });
});

describe("compareBlendOutput", () => {
  it("passes only an exact match", () => {
    const samples = buildBlendCheckSamples();
    expect(compareBlendOutput(samples.expected, Buffer.from(samples.expected))).toEqual({
      exact: true,
    });
    const nudged = Buffer.from(samples.expected);
    nudged.writeUInt16LE((nudged.readUInt16LE(600) + 1) & 0xffff, 600);
    const one = compareBlendOutput(samples.expected, nudged);
    expect(one.exact).toBe(false);
    if (!one.exact) expect(one.detail).toContain("on 1 of 49152 samples");
  });

  it("fails a blend that rounds 1 LSB away on partial alpha", () => {
    const samples = buildBlendCheckSamples();
    const result = compareBlendOutput(samples.expected, integerBlend(samples));
    expect(result.exact).toBe(false);
    if (!result.exact) expect(result.detail).toContain("up to 1 LSB");
  });

  it("fails a short output", () => {
    const samples = buildBlendCheckSamples();
    const result = compareBlendOutput(samples.expected, samples.expected.subarray(2));
    expect(result.exact).toBe(false);
  });
});

describe("buildBlendCheckArgs", () => {
  it("runs the composite's own blend filters on raw rgb48le / rgba64le frames", () => {
    const args = buildBlendCheckArgs(
      { width: 256, height: 64 },
      { video: "/t/v", overlay: "/t/o", out: "/t/out" },
    );
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toBe(`${buildBlendFilters("scale=threads=4,format=gbrp16le")}[out]`);
    expect(graph).toContain("maskedmerge");
    expect(args.join(" ")).toContain("-f rawvideo -pix_fmt rgb48le -s 256x64 -i /t/v");
    expect(args.join(" ")).toContain("-f rawvideo -pix_fmt rgba64le -s 256x64 -i /t/o");
    expect(args.slice(-5)).toEqual(["-f", "rawvideo", "-pix_fmt", "rgb48le", "/t/out"]);
  });
});

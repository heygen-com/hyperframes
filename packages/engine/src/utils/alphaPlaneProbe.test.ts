import { describe, expect, it } from "vitest";
import { inputAlphaOpaqueWarning, sampledRgbaAlphaIsFullyOpaque } from "./alphaPlaneProbe.js";

const BYTES_PER_FRAME = 8 * 8 * 4; // 256 — one 8x8 rgba frame

/** Build a raw rgba sample where the alpha byte of every pixel is `alpha`. */
function sample(alpha: number, frameCount: number): Buffer {
  const buf = Buffer.alloc(BYTES_PER_FRAME * frameCount, 0);
  for (let i = 3; i < buf.length; i += 4) {
    buf[i] = alpha;
  }
  return buf;
}

describe("sampledRgbaAlphaIsFullyOpaque", () => {
  it("returns true when every alpha byte in a single frame is 255", () => {
    expect(sampledRgbaAlphaIsFullyOpaque(sample(255, 1))).toBe(true);
  });

  it("returns true across a multi-frame sample (2 and 3 frames)", () => {
    expect(sampledRgbaAlphaIsFullyOpaque(sample(255, 2))).toBe(true);
    expect(sampledRgbaAlphaIsFullyOpaque(sample(255, 3))).toBe(true);
  });

  it("returns false when any pixel shows full transparency", () => {
    const buf = sample(255, 1);
    buf[3] = 0; // first pixel's alpha
    expect(sampledRgbaAlphaIsFullyOpaque(buf)).toBe(false);
  });

  it("returns false when any pixel shows partial transparency", () => {
    const buf = sample(255, 2);
    buf[3 + 4 * 10] = 254; // partial alpha on the 11th pixel
    expect(sampledRgbaAlphaIsFullyOpaque(buf)).toBe(false);
  });

  it("returns undefined for an empty sample (inconclusive, not a warning)", () => {
    expect(sampledRgbaAlphaIsFullyOpaque(Buffer.alloc(0))).toBeUndefined();
  });

  it("returns undefined for a byte count that is not a whole-frame multiple", () => {
    expect(sampledRgbaAlphaIsFullyOpaque(Buffer.alloc(BYTES_PER_FRAME - 1))).toBeUndefined();
  });

  it("returns undefined for an oversized sample beyond the 3-frame ceiling", () => {
    expect(sampledRgbaAlphaIsFullyOpaque(Buffer.alloc(BYTES_PER_FRAME * 4))).toBeUndefined();
  });
});

describe("inputAlphaOpaqueWarning", () => {
  it("names the offending file and carries the re-export remedy", () => {
    const line = inputAlphaOpaqueWarning("avatar.webm");
    expect(line).toContain('src="avatar.webm"');
    expect(line).toContain("declares an alpha channel");
    expect(line).toContain("decodes fully opaque");
    expect(line).toContain("yuva420p");
    expect(line).toContain("alpha sidecar");
    expect(line.endsWith("\n")).toBe(true);
  });
});

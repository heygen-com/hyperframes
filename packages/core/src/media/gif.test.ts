import { describe, expect, it } from "vitest";
import { parseAnimatedGifMetadata } from "./gif";

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function ascii(value: string): number[] {
  return Array.from(value).map((char) => char.charCodeAt(0));
}

function frame(delayCentiseconds: number): number[] {
  return [
    0x21,
    0xf9,
    0x04,
    0x00,
    ...u16(delayCentiseconds),
    0x00,
    0x00,
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x02,
    0x02,
    0x4c,
    0x01,
    0x00,
  ];
}

function gif(frames: number[], loopCount?: number): Uint8Array {
  const loop =
    loopCount === undefined
      ? []
      : [0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 0x03, 0x01, ...u16(loopCount), 0x00];
  return Uint8Array.from([
    ...ascii("GIF89a"),
    ...u16(1),
    ...u16(1),
    0x00,
    0x00,
    0x00,
    ...loop,
    ...frames,
    0x3b,
  ]);
}

describe("parseAnimatedGifMetadata", () => {
  it("detects single-frame GIFs without marking them animated", () => {
    const metadata = parseAnimatedGifMetadata(gif(frame(10)));

    expect(metadata?.frameCount).toBe(1);
    expect(metadata?.animated).toBe(false);
    expect(metadata?.durationSeconds).toBe(0.1);
  });

  it("preserves variable frame delays", () => {
    const metadata = parseAnimatedGifMetadata(gif([...frame(5), ...frame(15)]));

    expect(metadata?.animated).toBe(true);
    expect(metadata?.delaysCentiseconds).toEqual([5, 15]);
    expect(metadata?.durationSeconds).toBe(0.2);
  });

  it("clamps all-zero frame delays to the browser playback minimum", () => {
    const frames = Array.from({ length: 10 }, () => frame(0)).flat();
    const metadata = parseAnimatedGifMetadata(gif(frames, 0));

    expect(metadata?.animated).toBe(true);
    expect(metadata?.delaysCentiseconds).toEqual(Array.from({ length: 10 }, () => 10));
    expect(metadata?.durationSeconds).toBe(1);
  });

  it("reads Netscape loop metadata", () => {
    const metadata = parseAnimatedGifMetadata(gif([...frame(8), ...frame(8)], 0));

    expect(metadata?.loopCount).toBe(0);
  });

  it("returns null for non-GIF data", () => {
    expect(parseAnimatedGifMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

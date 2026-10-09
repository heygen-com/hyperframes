import { describe, expect, it } from "vitest";
import {
  clearGifFramesBeforeNext,
  gifClearsAfterLeavingFrameInPlace,
  parseAnimatedGifMetadata,
} from "./gif";

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

  it("gives every image without a control block the browser's minimum delay", () => {
    const metadata = parseAnimatedGifMetadata(gif([...frame(5).slice(8), ...frame(15).slice(8)]));
    expect(metadata?.delaysCentiseconds).toEqual([10, 10]);
    expect(metadata?.durationSeconds).toBe(0.2);
  });

  it("keeps delays aligned when an image has no control block", () => {
    const metadata = parseAnimatedGifMetadata(
      gif([...frame(5), ...frame(20).slice(8), ...frame(15)]),
    );
    expect(metadata?.delaysCentiseconds).toEqual([5, 10, 15]);
    expect(metadata?.frameCount).toBe(3);
    expect(metadata?.durationSeconds).toBe(0.3);
  });

  it("excludes a trailing control block without an image", () => {
    const metadata = parseAnimatedGifMetadata(
      gif([...frame(5), ...frame(15), ...frame(200).slice(0, 8)]),
    );
    expect(metadata?.delaysCentiseconds).toEqual([5, 15]);
    expect(metadata?.durationSeconds).toBe(0.2);
  });

  it("consumes the plain-text control without assigning it to an image", () => {
    const plainText = [0x21, 0x01, 12, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 65, 0];
    const text = [...frame(200).slice(0, 8), ...plainText];
    const metadata = parseAnimatedGifMetadata(gif([...text, ...frame(5).slice(8), ...frame(15)]));
    expect(metadata?.delaysCentiseconds).toEqual([10, 15]);
    expect(metadata?.durationSeconds).toBe(0.25);
  });

  it("keeps an image's control through comment extensions", () => {
    const comment = [0x21, 0xfe, 1, 65, 0];
    const image = [...frame(5).slice(0, 8), ...comment, ...frame(5).slice(8)];
    const metadata = parseAnimatedGifMetadata(gif([...image, ...frame(15)]));
    expect(metadata?.delaysCentiseconds).toEqual([5, 15]);
    expect(metadata?.durationSeconds).toBe(0.2);
  });

  it("reads Netscape loop metadata", () => {
    const metadata = parseAnimatedGifMetadata(gif([...frame(8), ...frame(8)], 0));

    expect(metadata?.loopCount).toBe(0);
  });

  it("returns null for non-GIF data", () => {
    expect(parseAnimatedGifMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

// A frame whose graphic control block has the given disposal and optional transparent index,
// optionally carrying its own two-entry colour table.
function controlledFrame(
  disposal: number,
  transparentIndex?: number,
  localTable = false,
): number[] {
  const bytes = frame(10);
  bytes[3] = (disposal << 2) | (transparentIndex === undefined ? 0 : 1);
  bytes[6] = transparentIndex ?? 0;
  if (localTable) {
    bytes[17] = 0b1000_0000;
    bytes.splice(18, 0, 0, 0, 0, 255, 255, 255);
  }
  return bytes;
}

function controls(bytes: Uint8Array): number[][] {
  return [...bytes.keys()]
    .filter((i) => bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04)
    .map((i) => [bytes[i + 3]!, bytes[i + 6]!]);
}

describe("gifClearsAfterLeavingFrameInPlace", () => {
  it("is true only when a frame left in place is followed by one cleared to background", () => {
    const leftInPlace = controlledFrame(1);
    const cleared = controlledFrame(2, 1);
    expect(gifClearsAfterLeavingFrameInPlace(gif([...leftInPlace, ...cleared]))).toBe(true);
    expect(gifClearsAfterLeavingFrameInPlace(gif([...cleared, ...leftInPlace]))).toBe(false);
    expect(gifClearsAfterLeavingFrameInPlace(gif([...leftInPlace, ...leftInPlace]))).toBe(false);
    expect(gifClearsAfterLeavingFrameInPlace(gif([...cleared, ...cleared]))).toBe(false);
    expect(gifClearsAfterLeavingFrameInPlace(Uint8Array.from(ascii("not a gif")))).toBeNull();
  });

  it("does not give an image the control block of the plain text before it", () => {
    const plainText = [0x21, 0x01, 12, ...new Array<number>(12).fill(0), 1, 65, 0];
    const textLeftInPlace = [...controlledFrame(1).slice(0, 8), ...plainText];
    const imageWithoutControl = controlledFrame(2, 1).slice(8);
    const bytes = gif([...textLeftInPlace, ...imageWithoutControl, ...controlledFrame(2, 1)]);
    expect(gifClearsAfterLeavingFrameInPlace(bytes)).toBe(false);
  });
});

describe("clearGifFramesBeforeNext", () => {
  it("clears every frame and names the shared table's transparent index where missing", () => {
    const bytes = gif([
      ...controlledFrame(2, 1, true), // own table: its index means nothing in the shared one
      ...controlledFrame(1),
      ...controlledFrame(2, 0),
    ]);

    expect(clearGifFramesBeforeNext(bytes)).toBe(true);

    expect(controls(bytes)).toEqual([
      [0b0000_1001, 1],
      [0b0000_1001, 0],
      [0b0000_1001, 0],
    ]);
  });

  it("refuses bytes that are not a GIF", () => {
    expect(clearGifFramesBeforeNext(Uint8Array.from(ascii("not a gif at all")))).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import {
  type ElementStackingInfo,
  type HdrTransfer,
  blitRgba8OverRgb48le,
  decodePngToRgb48le,
  getSrgbToSignalLut,
} from "@hyperframes/engine";
import {
  encodePngRgba16,
  hashOverlayPixels,
  mapOverlayToSignalRgba16,
  overlayElementIdsAboveVideo,
  OverlayStateMismatchError,
  type OverlayStateSource,
  verificationFrames,
  writeOverlayStates,
} from "./overlayCapture.js";
import type {
  CaptureOverlayStatesArgs,
  HdrPassthroughInput,
  OverlayPlan,
  OverlayState,
  PassthroughVideo,
} from "./types.js";

const TRANSFERS: HdrTransfer[] = ["hlg", "pq"];

/** Deterministic pseudo-random bytes (LCG) so failures reproduce. */
function syntheticRgba(pixelCount: number, seed: number): Uint8Array {
  const out = new Uint8Array(pixelCount * 4);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

/** Every alpha value 0..255 with varied colours, so the parity test covers all blend weights. */
function everyAlphaRgba(): Uint8Array {
  const out = syntheticRgba(256, 7);
  for (let a = 0; a < 256; a++) out[a * 4 + 3] = a;
  return out;
}

function readUint16BE(buf: Buffer, offset: number): number {
  return ((buf[offset] ?? 0) << 8) | (buf[offset + 1] ?? 0);
}

/** Minimal decoder for `encodePngRgba16` output (filter 0 only): returns big-endian RGBA16. */
function decodeRgba16Png(png: Buffer): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  data: Buffer;
} {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 8;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    raw.copy(data, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, bitDepth, colorType, data };
}

/** A constant HDR frame in rgb48le, as the layered path's canvas holds the video frame. */
function constantRgb48le(pixelCount: number, rgb: [number, number, number]): Buffer {
  const buf = Buffer.alloc(pixelCount * 6);
  for (let i = 0; i < pixelCount; i++) {
    buf.writeUInt16LE(rgb[0], i * 6);
    buf.writeUInt16LE(rgb[1], i * 6 + 2);
    buf.writeUInt16LE(rgb[2], i * 6 + 4);
  }
  return buf;
}

describe("mapOverlayToSignalRgba16", () => {
  it.each(TRANSFERS)("maps RGB through the layered LUT and widens alpha (%s)", (transfer) => {
    const lut = getSrgbToSignalLut(transfer);
    const rgba8 = syntheticRgba(64, 3);
    const out = mapOverlayToSignalRgba16(rgba8, transfer);
    expect(out.length).toBe(64 * 8);
    for (let i = 0; i < 64; i++) {
      for (let c = 0; c < 3; c++) {
        expect(readUint16BE(out, i * 8 + c * 2)).toBe(lut[rgba8[i * 4 + c] ?? 0] ?? -1);
      }
      expect(readUint16BE(out, i * 8 + 6)).toBe((rgba8[i * 4 + 3] ?? 0) * 257);
    }
  });

  it("keeps alpha straight (RGB is not scaled by alpha)", () => {
    const lut = getSrgbToSignalLut("hlg");
    const out = mapOverlayToSignalRgba16(new Uint8Array([255, 128, 0, 64]), "hlg");
    expect(readUint16BE(out, 0)).toBe(lut[255] ?? -1);
    expect(readUint16BE(out, 2)).toBe(lut[128] ?? -1);
    expect(readUint16BE(out, 4)).toBe(0);
    expect(readUint16BE(out, 6)).toBe(64 * 257);
  });

  it("maps alpha endpoints exactly", () => {
    const out = mapOverlayToSignalRgba16(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]), "pq");
    expect(readUint16BE(out, 6)).toBe(0);
    expect(readUint16BE(out, 14)).toBe(65535);
  });

  it("rejects a buffer that is not whole RGBA pixels", () => {
    expect(() => mapOverlayToSignalRgba16(new Uint8Array(6), "hlg")).toThrow(/whole RGBA/);
  });
});

describe("passthrough overlay vs. layered blend parity", () => {
  // A mid-grey-ish HLG/PQ background with distinct channels so a swapped channel shows up.
  const background: [number, number, number] = [41234, 30000, 9000];

  it.each(TRANSFERS)(
    "a straight-alpha over of the 16-bit overlay equals blitRgba8OverRgb48le (%s)",
    (transfer) => {
      const rgba8 = everyAlphaRgba();
      const pixelCount = rgba8.length / 4;

      const layered = constantRgb48le(pixelCount, background);
      blitRgba8OverRgb48le(rgba8, layered, pixelCount, 1, transfer);

      const png = encodePngRgba16(pixelCount, 1, mapOverlayToSignalRgba16(rgba8, transfer));
      const overlay = decodeRgba16Png(png).data;

      let maxIntegerDiff = 0;
      for (let i = 0; i < pixelCount; i++) {
        const a16 = readUint16BE(overlay, i * 8 + 6);
        for (let c = 0; c < 3; c++) {
          const signal = readUint16BE(overlay, i * 8 + c * 2);
          const expected = layered.readUInt16LE(i * 6 + c * 2);
          // Float straight-alpha over in the same RGB signal space: exact.
          const a = a16 / 65535;
          const viaFloat =
            a16 === 0 ? background[c] : Math.round(signal * a + background[c]! * (1 - a));
          expect(viaFloat).toBe(expected);
          // Integer 16-bit blend as a filter graph would compute it: within 1 LSB.
          const viaInteger = Math.floor(
            (signal * a16 + background[c]! * (65535 - a16) + 32767) / 65535,
          );
          maxIntegerDiff = Math.max(maxIntegerDiff, Math.abs(viaInteger - expected));
        }
      }
      expect(maxIntegerDiff).toBeLessThanOrEqual(1);
    },
  );
});

describe("encodePngRgba16", () => {
  it("writes a 16-bit RGBA PNG that round-trips and the engine decoder reads", () => {
    const width = 5;
    const height = 3;
    const rgba16 = mapOverlayToSignalRgba16(syntheticRgba(width * height, 11), "hlg");
    const png = encodePngRgba16(width, height, rgba16);

    const decoded = decodeRgba16Png(png);
    expect(decoded).toMatchObject({ width, height, bitDepth: 16, colorType: 6 });
    expect(decoded.data.equals(rgba16)).toBe(true);

    const rgb48 = decodePngToRgb48le(png);
    expect(rgb48.width).toBe(width);
    expect(rgb48.height).toBe(height);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) {
        expect(rgb48.data.readUInt16LE(i * 6 + c * 2)).toBe(readUint16BE(rgba16, i * 8 + c * 2));
      }
    }
  });

  it("is byte-identical for identical pixels", () => {
    const rgba16 = mapOverlayToSignalRgba16(syntheticRgba(16, 5), "pq");
    expect(encodePngRgba16(4, 4, rgba16).equals(encodePngRgba16(4, 4, Buffer.from(rgba16)))).toBe(
      true,
    );
  });

  it("rejects a size mismatch", () => {
    expect(() => encodePngRgba16(2, 2, Buffer.alloc(8))).toThrow(/expected 32 bytes/);
  });
});

describe("hashOverlayPixels", () => {
  it("is a stable sha256 that separates different pixels", () => {
    const a = syntheticRgba(8, 1);
    expect(hashOverlayPixels(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOverlayPixels(a)).toBe(hashOverlayPixels(new Uint8Array(a)));
    const b = new Uint8Array(a);
    b[3] = (b[3]! + 1) & 0xff;
    expect(hashOverlayPixels(b)).not.toBe(hashOverlayPixels(a));
  });
});

function el(id: string, zIndex: number, isHdr = false): ElementStackingInfo {
  return {
    id,
    zIndex,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    layoutWidth: 1,
    layoutHeight: 1,
    opacity: 1,
    visible: true,
    renderFrameVisible: false,
    isHdr,
    transform: "none",
    borderRadius: [0, 0, 0, 0],
    objectFit: "fill",
    objectPosition: "50% 50%",
    clipRect: null,
  };
}

describe("overlayElementIdsAboveVideo", () => {
  it("returns only the DOM elements z-ordered above the video", () => {
    const stacking = [el("caption", 5), el("bg", 0), el("video", 1, true), el("title", 5)];
    expect(overlayElementIdsAboveVideo(stacking, "video")).toEqual(["caption", "title"]);
  });

  it("returns nothing when the video is on top", () => {
    expect(overlayElementIdsAboveVideo([el("bg", 0), el("video", 9, true)], "video")).toEqual([]);
  });

  it("throws when the video is not in the stacking", () => {
    expect(() => overlayElementIdsAboveVideo([el("bg", 0)], "video")).toThrow(/missing/);
  });
});

describe("writeOverlayStates", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hdrpt-overlay-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const width = 2;
  const height = 2;

  function state(index: number, startFrame: number, endFrame: number): OverlayState {
    return {
      index,
      startFrame,
      endFrame,
      captureFrame: Math.floor((startFrame + endFrame - 1) / 2),
    };
  }

  function makeArgs(states: OverlayState[], assertNotAborted: () => void = () => {}) {
    const plan: OverlayPlan = {
      states,
      fps: { num: 30000, den: 1001 },
      totalFrames: states.at(-1)?.endFrame ?? 0,
      width,
      height,
    };
    const progress: Array<[number, number, number]> = [];
    const args: CaptureOverlayStatesArgs = {
      input: { assertNotAborted } as unknown as HdrPassthroughInput,
      session: {} as CaptureOverlayStatesArgs["session"],
      plan,
      video: { id: "video", transfer: "hlg" } as PassthroughVideo,
      outDir: join(dir, "overlays"),
      onStateCaptured: (frames, done, total) => progress.push([frames, done, total]),
    };
    return { args, progress };
  }

  /**
   * A source whose overlay is `keys[i]` / `pixels[i]` on every frame of candidate `i`, unless
   * `override(frame)` says otherwise; records what it was asked for, as candidate indexes and
   * as frames.
   */
  function fakeSource(
    states: readonly OverlayState[],
    keys: string[],
    pixels: Uint8Array[],
    override?: (frame: number) => { key: string; pixels: Uint8Array } | undefined,
  ) {
    const probed: number[] = [];
    const probedFrames: number[] = [];
    const captured: number[] = [];
    const capturedFrames: number[] = [];
    const times: number[] = [];
    let last: number | undefined;
    const at = (frame: number) => {
      const index = states.findIndex((s) => frame >= s.startFrame && frame < s.endFrame);
      expect(index).toBeGreaterThanOrEqual(0);
      return { index, ...(override?.(frame) ?? { key: keys[index]!, pixels: pixels[index]! }) };
    };
    const source: OverlayStateSource = {
      async probe(frame, time) {
        probed.push(at(frame).index);
        probedFrames.push(frame);
        times.push(time);
        last = frame;
        return at(frame).key;
      },
      async capture(frame) {
        expect(frame).toBe(last!);
        captured.push(at(frame).index);
        capturedFrames.push(frame);
        return at(frame).pixels;
      },
    };
    return { source, probed, probedFrames, captured, capturedFrames, times };
  }

  it("dedupes identical states onto one PNG and reports cumulative progress", async () => {
    const caption = syntheticRgba(width * height, 21);
    const empty = new Uint8Array(width * height * 4);
    const pixels = [empty, caption, empty, new Uint8Array(caption)];
    const states = [state(0, 0, 10), state(1, 10, 25), state(2, 25, 26), state(3, 26, 40)];
    const { args, progress } = makeArgs(states);
    // The last state has a new fingerprint but the same pixels as the second: captured, not written.
    const { source, captured, probedFrames, times } = fakeSource(
      states,
      ["gap", "cue", "gap", "cue'"],
      pixels,
    );

    const result = await writeOverlayStates(args, source);

    expect(result.uniqueCount).toBe(2);
    expect(result.candidateCount).toBe(4);
    expect(captured).toEqual([0, 1, 3]);
    expect(result.captureCount).toBe(3);
    expect(result.dir).toBe(join(dir, "overlays"));
    expect(result.overlays.map((o) => o.state)).toEqual(states);
    expect(result.plan.states).toEqual(states);
    expect(result.overlays.map((o) => o.pngPath)).toEqual([
      join(dir, "overlays", "overlay-0.png"),
      join(dir, "overlays", "overlay-1.png"),
      join(dir, "overlays", "overlay-0.png"),
      join(dir, "overlays", "overlay-1.png"),
    ]);
    expect(result.overlays[0]!.hash).toBe(hashOverlayPixels(empty));
    expect(result.overlays[3]!.hash).toBe(hashOverlayPixels(caption));
    expect((await readdir(join(dir, "overlays"))).sort()).toEqual([
      "overlay-0.png",
      "overlay-1.png",
    ]);
    expect(progress).toEqual([
      [10, 1, 4],
      [25, 2, 4],
      [26, 3, 4],
      [40, 4, 4],
    ]);
    // Each candidate's capture frame; a state's first and last frame once the next one opens.
    expect(probedFrames).toEqual([4, 17, 0, 9, 25, 10, 24, 32, 26, 39]);
    expect(result.verifyProbeCount).toBe(6);
    // frame / fps, the layered loop's frame-time formula.
    expect(times).toEqual(probedFrames.map((f) => (f * 1001) / 30000));

    const written = decodeRgba16Png(await readFile(join(dir, "overlays", "overlay-1.png")));
    expect(written.data.equals(mapOverlayToSignalRgba16(caption, "hlg"))).toBe(true);
  });

  it("folds the candidates of one clip cut into the states on either side of the real flip", async () => {
    // A cue from frame 30 to 60: each cut claims round(t * fps) +/- 1, so the planner cuts at
    // 29, 30, 31, 32 and 59, 60, 61, 62. The caption really shows on frames 30..59.
    const cuts = [0, 29, 30, 31, 32, 59, 60, 61, 62, 90];
    const states = cuts.slice(0, -1).map((start, i) => state(i, start, cuts[i + 1]!));
    const shown = (s: OverlayState) => s.captureFrame >= 30 && s.captureFrame < 60;
    const caption = syntheticRgba(width * height, 4);
    const empty = new Uint8Array(width * height * 4);
    const { args } = makeArgs(states);
    const { source, probed, captured } = fakeSource(
      states,
      states.map((s) => (shown(s) ? "cue" : "gap")),
      states.map((s) => (shown(s) ? caption : empty)),
    );

    const result = await writeOverlayStates(args, source);

    // Candidates in order; the verification probes of each closed state follow its last one.
    expect(probed.slice(0, 3)).toEqual([0, 1, 2]);
    expect([...new Set(probed)].sort((a, b) => a - b)).toEqual(states.map((s) => s.index));
    // One screenshot per distinct overlay: the gap after the cue reuses the first gap's capture.
    expect(captured).toEqual([0, 2]);
    expect(result.plan.states).toEqual([
      { index: 0, startFrame: 0, endFrame: 30, captureFrame: 14 },
      { index: 1, startFrame: 30, endFrame: 60, captureFrame: 30 },
      { index: 2, startFrame: 60, endFrame: 90, captureFrame: 60 },
    ]);
    expect(result.overlays.map((o) => o.state)).toEqual(result.plan.states);
    expect(result.overlays.map((o) => o.hash)).toEqual([
      hashOverlayPixels(empty),
      hashOverlayPixels(caption),
      hashOverlayPixels(empty),
    ]);
    expect(result.plan).toMatchObject({ totalFrames: 90, width, height, fps: args.plan.fps });
  });

  it("keeps a one-frame change inside a held overlay as its own state", async () => {
    const states = [state(0, 0, 10), state(1, 10, 11), state(2, 11, 20)];
    const base = syntheticRgba(width * height, 8);
    const nudged = new Uint8Array(base);
    nudged[5] = (nudged[5]! + 1) & 0xff;
    const { args } = makeArgs(states);
    const { source, captured } = fakeSource(states, ["a", "b", "a"], [base, nudged, base]);

    const result = await writeOverlayStates(args, source);

    // The return to "a" reuses the first capture: same fingerprint, same pixels.
    expect(captured).toEqual([0, 1]);
    expect(result.plan.states.map((s) => [s.startFrame, s.endFrame])).toEqual([
      [0, 10],
      [10, 11],
      [11, 20],
    ]);
    expect(result.overlays[1]!.hash).toBe(hashOverlayPixels(nudged));
    expect(result.uniqueCount).toBe(2);
  });

  it("merges candidates whose fingerprints differ but whose pixels are identical", async () => {
    const states = [state(0, 0, 5), state(1, 5, 6), state(2, 6, 12)];
    const pixels = syntheticRgba(width * height, 2);
    const { args } = makeArgs(states);
    const { source, captured } = fakeSource(states, ["a", "b", "b"], [pixels, pixels, pixels]);

    const result = await writeOverlayStates(args, source);

    expect(captured).toEqual([0, 1]);
    expect(result.plan.states).toEqual([
      { index: 0, startFrame: 0, endFrame: 12, captureFrame: 2 },
    ]);
    expect(result.captureCount).toBe(2);
    expect(result.uniqueCount).toBe(1);
  });

  it("checks for abort before every state", async () => {
    let calls = 0;
    const states = [state(0, 0, 5), state(1, 5, 9)];
    const { args } = makeArgs(states, () => {
      calls += 1;
      if (calls === 2) throw new DOMException("aborted", "AbortError");
    });
    const empty = new Uint8Array(width * height * 4);
    const { source, probed } = fakeSource(states, ["a", "b"], [empty, empty]);
    await expect(writeOverlayStates(args, source)).rejects.toThrow("aborted");
    expect(probed).toEqual([0]);
  });

  it("rejects a capture of the wrong size", async () => {
    const states = [state(0, 0, 5)];
    const { args } = makeArgs(states);
    const { source } = fakeSource(states, ["a"], [new Uint8Array(4)]);
    await expect(writeOverlayStates(args, source)).rejects.toThrow(/expected 16/);
  });

  it("falls back when a frame the planner called static renders a different overlay", async () => {
    // A seek-driven script the static analysis cannot see rewrites a counter from frame 50 on:
    // the candidate's capture frame (40) shows the old text, the probe half a second later
    // (frame 55) the new one.
    const states = [state(0, 0, 20), state(1, 20, 21), state(2, 21, 60)];
    const caption = syntheticRgba(width * height, 11);
    const counter = syntheticRgba(width * height, 12);
    const empty = new Uint8Array(width * height * 4);
    const { args } = makeArgs(states);
    const { source, capturedFrames } = fakeSource(
      states,
      ["gap", "cue", "gap"],
      [empty, caption, empty],
      (frame) => (frame >= 50 ? { key: "counter", pixels: counter } : undefined),
    );

    const failure = writeOverlayStates(args, source);

    await expect(failure).rejects.toBeInstanceOf(OverlayStateMismatchError);
    await expect(failure).rejects.toThrow(/frame 55 differs from its state \[21, 60\)/);
    expect(capturedFrames).toEqual([9, 20, 55]);
  });

  it("probes long candidates at least every half second", async () => {
    // fps 30000/1001: a gap of ceil(14.985) = 15 frames. A change only on frames 28..34 sits
    // between the first frame (0) and the capture frame (49), so only an interior probe sees it.
    const states = [state(0, 0, 100)];
    const base = syntheticRgba(width * height, 13);
    const blip = syntheticRgba(width * height, 14);
    const { args } = makeArgs(states);
    const { source, probedFrames } = fakeSource(states, ["a"], [base], (frame) =>
      frame >= 28 && frame < 35 ? { key: "blip", pixels: blip } : undefined,
    );

    await expect(writeOverlayStates(args, source)).rejects.toThrow(/frame 30 differs/);
    expect(probedFrames.slice(0, 4)).toEqual([49, 0, 15, 30]);
  });

  it("checks every candidate's own first and last frame, not only the merged state's", async () => {
    // Two candidates with the same overlay merge into [0, 20). A change on frames 9..10 sits at
    // the first candidate's last frame, which neither capture frame (4, 14) nor the merged
    // state's edges (0, 19) would show.
    const states = [state(0, 0, 10), state(1, 10, 20)];
    const base = syntheticRgba(width * height, 16);
    const other = syntheticRgba(width * height, 17);
    const { args } = makeArgs(states);
    const { source, probedFrames } = fakeSource(states, ["a", "a"], [base, base], (frame) =>
      frame === 9 || frame === 10 ? { key: "x", pixels: other } : undefined,
    );

    await expect(writeOverlayStates(args, source)).rejects.toThrow(
      /frame 9 differs from its state \[0, 20\)/,
    );
    expect(probedFrames).toEqual([4, 14, 0, 9]);
  });

  it("accepts a verification probe with a new fingerprint but the state's pixels", async () => {
    const states = [state(0, 0, 10)];
    const pixels = syntheticRgba(width * height, 15);
    const { args } = makeArgs(states);
    const { source, capturedFrames } = fakeSource(states, ["a"], [pixels], (frame) =>
      frame === 9 ? { key: "a'", pixels: new Uint8Array(pixels) } : undefined,
    );

    const result = await writeOverlayStates(args, source);

    expect(capturedFrames).toEqual([4, 9]);
    expect(result.captureCount).toBe(2);
    expect(result.verifyProbeCount).toBe(2);
    expect(result.plan.states).toEqual([
      { index: 0, startFrame: 0, endFrame: 10, captureFrame: 4 },
    ]);
  });
});

describe("verificationFrames", () => {
  it("probes the first and last frame of a state", () => {
    expect(verificationFrames(10, 20, new Set([14]), 30)).toEqual([10, 19]);
  });

  it("skips frames already probed and one-frame states", () => {
    expect(verificationFrames(5, 6, new Set([5]), 30)).toEqual([]);
    expect(verificationFrames(5, 7, new Set([5, 6]), 30)).toEqual([]);
  });

  it("fills gaps longer than the limit between probed frames", () => {
    expect(verificationFrames(0, 100, new Set([49]), 30)).toEqual([0, 30, 79, 99]);
    expect(verificationFrames(0, 10, new Set(), 4)).toEqual([0, 4, 8, 9]);
  });

  it("ignores probed frames outside the state and empty ranges", () => {
    expect(verificationFrames(10, 12, new Set([3, 40]), 30)).toEqual([10, 11]);
    expect(verificationFrames(10, 10, new Set(), 30)).toEqual([]);
  });
});

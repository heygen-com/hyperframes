import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEAN, STD, applyMask } from "./inference.js";

// Regression: the u2net_human_seg model was trained with ImageNet
// normalization. Drifting away from these exact values changes the input
// tensor at every pixel and shifts the predicted alpha mask noticeably
// (Miguel reproduced 8,317 pixel changes with delta up to 78/255 when std
// was set to (1, 1, 1)). Reference:
// https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net_human_seg.py#L33
describe("background-removal/inference — rembg u2net_human_seg parity", () => {
  it("MEAN matches U2netHumanSegSession reference", () => {
    expect(MEAN).toEqual([0.485, 0.456, 0.406]);
  });

  it("STD matches U2netHumanSegSession reference (ImageNet, not the base u2net's (1,1,1))", () => {
    expect(STD).toEqual([0.229, 0.224, 0.225]);
  });
});

// These tests pin the contract that `--background-output` is built on:
// fg.alpha + bg.alpha === 255 per pixel, and the RGB plane is byte-identical
// between fg and bg. A future change to the postprocess loop (different mask
// threshold, premultiplied alpha, gamma-corrected compositing) that breaks
// either invariant should fail here loudly.
describe("background-removal/inference — applyMask invariants", () => {
  function makeRgb(pixels: number): Buffer {
    // Deterministic but non-trivial RGB so byte equality is meaningful.
    const buf = Buffer.allocUnsafe(pixels * 3);
    for (let i = 0; i < pixels; i++) {
      buf[i * 3] = (i * 7) & 0xff;
      buf[i * 3 + 1] = (i * 13 + 31) & 0xff;
      buf[i * 3 + 2] = (i * 19 + 61) & 0xff;
    }
    return buf;
  }

  function makeMask(pixels: number): Buffer {
    // Hit the saturation endpoints (0, 255) and a few mid-tone values so the
    // 255-m inversion is exercised across the full byte range.
    const buf = Buffer.allocUnsafe(pixels);
    for (let i = 0; i < pixels; i++) buf[i] = (i * 37) & 0xff;
    return buf;
  }

  it("dual-output: fg.alpha + bg.alpha === 255 for every pixel", () => {
    const pixels = 64;
    const rgb = makeRgb(pixels);
    const mask = makeMask(pixels);
    const fg = Buffer.allocUnsafe(pixels * 4);
    const bg = Buffer.allocUnsafe(pixels * 4);

    const result = applyMask(rgb, mask, fg, bg, pixels);

    expect(result.fg).toBe(fg);
    expect(result.bg).toBe(bg);
    for (let i = 0; i < pixels; i++) {
      const sum = fg[i * 4 + 3]! + bg[i * 4 + 3]!;
      expect(sum).toBe(255);
    }
  });

  it("dual-output: RGB triples are byte-identical between fg and bg", () => {
    const pixels = 64;
    const rgb = makeRgb(pixels);
    const mask = makeMask(pixels);
    const fg = Buffer.allocUnsafe(pixels * 4);
    const bg = Buffer.allocUnsafe(pixels * 4);

    applyMask(rgb, mask, fg, bg, pixels);

    for (let i = 0; i < pixels; i++) {
      expect(fg[i * 4]).toBe(bg[i * 4]);
      expect(fg[i * 4 + 1]).toBe(bg[i * 4 + 1]);
      expect(fg[i * 4 + 2]).toBe(bg[i * 4 + 2]);
      // And both match the source.
      expect(fg[i * 4]).toBe(rgb[i * 3]);
      expect(fg[i * 4 + 1]).toBe(rgb[i * 3 + 1]);
      expect(fg[i * 4 + 2]).toBe(rgb[i * 3 + 2]);
    }
  });

  it("dual-output: fg.alpha equals the input mask", () => {
    const pixels = 32;
    const rgb = makeRgb(pixels);
    const mask = makeMask(pixels);
    const fg = Buffer.allocUnsafe(pixels * 4);
    const bg = Buffer.allocUnsafe(pixels * 4);

    applyMask(rgb, mask, fg, bg, pixels);

    for (let i = 0; i < pixels; i++) {
      expect(fg[i * 4 + 3]).toBe(mask[i]);
    }
  });

  it("single-output: bg=null returns bg=null and writes only fg", () => {
    const pixels = 32;
    const rgb = makeRgb(pixels);
    const mask = makeMask(pixels);
    const fg = Buffer.allocUnsafe(pixels * 4);

    const result = applyMask(rgb, mask, fg, null, pixels);

    expect(result.bg).toBeNull();
    expect(result.fg).toBe(fg);
    for (let i = 0; i < pixels; i++) {
      expect(fg[i * 4]).toBe(rgb[i * 3]);
      expect(fg[i * 4 + 3]).toBe(mask[i]);
    }
  });

  it("saturates correctly at mask=0 and mask=255", () => {
    // mask=0 → fg.alpha=0 (transparent subject), bg.alpha=255 (fully opaque plate)
    // mask=255 → fg.alpha=255 (fully opaque subject), bg.alpha=0 (transparent plate)
    const rgb = Buffer.from([10, 20, 30, 40, 50, 60]);
    const mask = Buffer.from([0, 255]);
    const fg = Buffer.allocUnsafe(8);
    const bg = Buffer.allocUnsafe(8);

    applyMask(rgb, mask, fg, bg, 2);

    expect(fg[3]).toBe(0);
    expect(bg[3]).toBe(255);
    expect(fg[7]).toBe(255);
    expect(bg[7]).toBe(0);
  });
});

// onnxruntime-node and sharp are optional native modules; when their platform
// binary can't load, createSession must fail with an actionable install hint
// (and before touching the network / model download), not a raw module error.
describe("background-removal/inference — missing optional native modules", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("createSession throws an actionable error when onnxruntime-node can't load", async () => {
    vi.doMock("onnxruntime-node", () => {
      throw new Error("Cannot find module 'onnxruntime-node'");
    });
    const { createSession } = await import("./inference.js");
    await expect(createSession()).rejects.toThrow(
      /onnxruntime-node.*isn't available[\s\S]*npm i onnxruntime-node/,
    );
    vi.doUnmock("onnxruntime-node");
  });

  it("createSession throws an actionable error when sharp can't load", async () => {
    vi.doMock("onnxruntime-node", () => ({ InferenceSession: {}, Tensor: {} }));
    vi.doMock("sharp", () => {
      throw new Error("Could not load the sharp module");
    });
    const { createSession } = await import("./inference.js");
    await expect(createSession()).rejects.toThrow(/sharp.*isn't available[\s\S]*npm i sharp/);
    vi.doUnmock("onnxruntime-node");
    vi.doUnmock("sharp");
  });
});

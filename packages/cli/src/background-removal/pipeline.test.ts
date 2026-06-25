import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import {
  inferOutputFormat,
  inferInputKind,
  buildEncoderArgs,
  resolveRenderTargets,
  waitForExit,
} from "./pipeline.js";

describe("background-removal/pipeline — inferOutputFormat", () => {
  it("maps .webm → webm", () => {
    expect(inferOutputFormat("/tmp/out.webm")).toBe("webm");
  });
  it("maps .mov → mov", () => {
    expect(inferOutputFormat("/tmp/out.mov")).toBe("mov");
  });
  it("maps .png → png", () => {
    expect(inferOutputFormat("/tmp/out.png")).toBe("png");
  });
  it("rejects unknown extensions", () => {
    expect(() => inferOutputFormat("/tmp/out.mp4")).toThrow(/Unsupported output extension/);
  });
});

describe("background-removal/pipeline — inferInputKind", () => {
  it("recognizes mp4/mov/webm/mkv/avi as video", () => {
    for (const ext of [".mp4", ".mov", ".webm", ".mkv", ".avi"]) {
      expect(inferInputKind(`/tmp/clip${ext}`)).toBe("video");
    }
  });
  it("recognizes jpg/png/webp as image", () => {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
      expect(inferInputKind(`/tmp/img${ext}`)).toBe("image");
    }
  });
  it("rejects unknown extensions", () => {
    expect(() => inferInputKind("/tmp/file.gif")).toThrow(/Unsupported input/);
  });
});

describe("background-removal/pipeline — buildEncoderArgs", () => {
  it("webm preset emits VP9 + alpha_mode metadata", () => {
    const args = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/out.webm");
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("yuva420p");
    expect(args[args.indexOf("-cpu-used") + 1]).toBe("4");
    // The alpha_mode metadata must be present; without it Chrome ignores the alpha plane.
    const idx = args.indexOf("-metadata:s:v:0");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("alpha_mode=1");
    expect(args[args.length - 1]).toBe("/tmp/out.webm");
  });

  it("webm preset tags BT.709 colorspace + limited range", () => {
    // Without these tags, ffmpeg's RGB→YUV conversion uses the BT.601 default,
    // and Chrome's YUV→RGB pass on the resulting webm produces a different
    // RGB triple than the source mp4 (visible color shift on overlay). Pin
    // BT.709 limited-range so the cutout matches modern Rec.709 sources.
    const args = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/out.webm");
    const csIdx = args.indexOf("-colorspace");
    expect(csIdx).toBeGreaterThan(-1);
    expect(args[csIdx + 1]).toBe("bt709");
    const rangeIdx = args.indexOf("-color_range");
    expect(rangeIdx).toBeGreaterThan(-1);
    expect(args[rangeIdx + 1]).toBe("tv");
  });

  it("webm quality presets map to crf 30/18/12", () => {
    const fast = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/o.webm", "fast");
    const balanced = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/o.webm", "balanced");
    const best = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/o.webm", "best");
    const crf = (args: string[]) => args[args.indexOf("-crf") + 1];
    expect(crf(fast)).toBe("30");
    expect(crf(balanced)).toBe("18");
    expect(crf(best)).toBe("12");
  });

  it("webm default quality is balanced (crf 18)", () => {
    const args = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/o.webm");
    expect(args[args.indexOf("-crf") + 1]).toBe("18");
  });

  it("mov preset emits ProRes 4444 + yuva444p10le", () => {
    const args = buildEncoderArgs("mov", 1920, 1080, 30, "/tmp/out.mov");
    expect(args).toContain("prores_ks");
    expect(args).toContain("4444");
    expect(args).toContain("yuva444p10le");
  });

  it("png preset emits a single RGBA frame", () => {
    const args = buildEncoderArgs("png", 1920, 1080, 30, "/tmp/out.png");
    expect(args).toContain("-frames:v");
    expect(args).toContain("rgba");
  });

  it("threads input dimensions and fps into raw video header", () => {
    const args = buildEncoderArgs("webm", 640, 480, 24, "/tmp/o.webm");
    const sIdx = args.indexOf("-s");
    expect(args[sIdx + 1]).toBe("640x480");
    const rIdx = args.indexOf("-r");
    expect(args[rIdx + 1]).toBe("24");
  });
});

describe("background-removal/pipeline — resolveRenderTargets", () => {
  it("resolves a normal video → webm render", () => {
    const t = resolveRenderTargets("/tmp/clip.mp4", "/tmp/cutout.webm");
    expect(t.format).toBe("webm");
    expect(t.inputKind).toBe("video");
    expect(t.bgFormat).toBeUndefined();
  });

  it("resolves an image → png render", () => {
    const t = resolveRenderTargets("/tmp/portrait.jpg", "/tmp/cutout.png");
    expect(t.format).toBe("png");
    expect(t.inputKind).toBe("image");
  });

  it("rejects image input with a video output extension", () => {
    expect(() => resolveRenderTargets("/tmp/portrait.jpg", "/tmp/cutout.webm")).toThrow(
      /Image input requires a \.png output/,
    );
  });

  it("rejects video input with a .png output", () => {
    expect(() => resolveRenderTargets("/tmp/clip.mp4", "/tmp/cutout.png")).toThrow(
      /Video input requires a \.webm or \.mov output/,
    );
  });

  it("threads background-output format through when valid", () => {
    const t = resolveRenderTargets("/tmp/clip.mp4", "/tmp/fg.webm", "/tmp/bg.webm");
    expect(t.bgFormat).toBe("webm");
    const tMov = resolveRenderTargets("/tmp/clip.mp4", "/tmp/fg.webm", "/tmp/bg.mov");
    expect(tMov.bgFormat).toBe("mov");
  });

  it("rejects --background-output for image inputs (no temporal pairing to do)", () => {
    expect(() =>
      resolveRenderTargets("/tmp/portrait.jpg", "/tmp/cutout.png", "/tmp/bg.png"),
    ).toThrow(/--background-output is not supported for image inputs/);
  });

  it("rejects .png as the --background-output extension", () => {
    // .png is only valid for single-image inputs, and image inputs themselves
    // can't have a background-output anyway. So .png here is always a misuse.
    expect(() => resolveRenderTargets("/tmp/clip.mp4", "/tmp/fg.webm", "/tmp/bg.png")).toThrow(
      /--background-output must be \.webm or \.mov/,
    );
  });
});

// Regression: a previous version of waitForExit treated `code === null` as
// success. Per Node's child_process docs, that's the signal-killed case —
// reporting it as success means a SIGTERM/SIGKILL'd ffmpeg encoder produces
// a "successful" render with a missing or truncated output file.
describe("background-removal/pipeline — waitForExit signal handling", () => {
  function fakeProc(): ReturnType<typeof spawn> {
    return new EventEmitter() as unknown as ReturnType<typeof spawn>;
  }

  it("resolves on a clean exit (code=0, signal=null)", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "");
    proc.emit("exit", 0, null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects when killed by signal (code=null, signal='SIGTERM')", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "tail of stderr");
    proc.emit("exit", null, "SIGTERM");
    await expect(promise).rejects.toThrow(/killed by SIGTERM/);
    await expect(promise).rejects.toThrow(/tail of stderr/);
  });

  it("rejects on non-zero exit code", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "");
    proc.emit("exit", 1, null);
    await expect(promise).rejects.toThrow(/exited with code 1/);
  });

  it("rejects on SIGKILL", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "");
    proc.emit("exit", null, "SIGKILL");
    await expect(promise).rejects.toThrow(/killed by SIGKILL/);
  });
});

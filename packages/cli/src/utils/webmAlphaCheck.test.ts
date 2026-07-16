import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webmAlphaAdvisory } from "./webmAlphaCheck.js";

describe("webmAlphaAdvisory", () => {
  it("warns when a probed webm lacks the ALPHA_MODE sidecar tag", () => {
    // A build that dropped the alpha sidecar: ffprobe reported a stream but no
    // ALPHA_MODE=1 tag. (pix_fmt is irrelevant — libvpx-vp9 always reports
    // yuv420p; the sidecar tag is the real signal.)
    const msg = webmAlphaAdvisory("webm", { probed: true, alphaMode: false });
    expect(msg).toBeDefined();
    expect(msg).toContain("ALPHA_MODE");
    expect(msg).toContain("--format mov");
  });

  it("stays SILENT when the webm carries ALPHA_MODE=1 (working transparent WebM)", () => {
    // Regression guard for the #2044 R1 blocker: a correct transparent WebM
    // reports pix_fmt=yuv420p BUT ALPHA_MODE=1 — it must NOT warn.
    expect(webmAlphaAdvisory("webm", { probed: true, alphaMode: true })).toBeUndefined();
  });

  it("stays silent when the output could not be probed", () => {
    expect(webmAlphaAdvisory("webm", { probed: false, alphaMode: false })).toBeUndefined();
  });

  it("stays silent for non-webm formats (mp4 opaque; mov carries alpha natively)", () => {
    expect(webmAlphaAdvisory("mp4", { probed: true, alphaMode: false })).toBeUndefined();
    expect(webmAlphaAdvisory("mov", { probed: true, alphaMode: false })).toBeUndefined();
  });

  it("warns when tag is present but sampled frames all read alpha=255", () => {
    const msg = webmAlphaAdvisory("webm", {
      probed: true,
      alphaMode: true,
      sampledAlphaFullyOpaque: true,
    });
    expect(msg).toBeDefined();
    expect(msg).toContain("ALPHA_MODE=1");
    expect(msg).toContain("prores_ks");
  });

  it("stays silent when tag is present and sampled frames are not fully opaque", () => {
    expect(
      webmAlphaAdvisory("webm", {
        probed: true,
        alphaMode: true,
        sampledAlphaFullyOpaque: false,
      }),
    ).toBeUndefined();
  });

  it("stays silent when the pixel-level probe couldn't run (undefined)", () => {
    // Preserves #2044 behavior: an inconclusive probe is not a warning trigger.
    expect(
      webmAlphaAdvisory("webm", {
        probed: true,
        alphaMode: true,
        sampledAlphaFullyOpaque: undefined,
      }),
    ).toBeUndefined();
  });
});

/**
 * Direct probe tests. The pixel-level contract (decoder args, byte-count
 * gate, alpha-stride walk) is too load-bearing to only cover through
 * `webmAlphaAdvisory`. These mock `execFileSync` + `findFFmpeg` so the same
 * production dispatch runs with a controlled byte stream.
 */
describe("sampledAlphaIsFullyOpaque", () => {
  const FAKE_FFMPEG = "/fake/bin/ffmpeg";
  const FAKE_WEBM = "/tmp/fake.webm";
  const BYTES_PER_FRAME = 8 * 8 * 4; // 256

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
    vi.doUnmock("../browser/ffmpeg.js");
  });

  function opaqueBuffer(frameCount: number): Buffer {
    return Buffer.alloc(BYTES_PER_FRAME * frameCount, 0xff);
  }

  async function importWithMocks(
    execImpl: (cmd: string, args: readonly string[], opts?: unknown) => Buffer,
    ffmpegPath: string | null = FAKE_FFMPEG,
  ) {
    vi.doMock("node:child_process", () => ({ execFileSync: execImpl }));
    vi.doMock("../browser/ffmpeg.js", () => ({
      findFFmpeg: () => ffmpegPath,
      findFFprobe: () => null,
    }));
    return await import("./webmAlphaCheck.js");
  }

  it("returns true for a 3-frame all-opaque decode (768 bytes)", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => opaqueBuffer(3));
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBe(true);
  });

  it("returns true for a valid 2-frame short-EOF decode (512 bytes)", async () => {
    // Regression guard for R1 blocker: `-frames:v 3` means AT MOST 3; a
    // legitimate 2-frame WebM must not be misclassified as a probe failure.
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => opaqueBuffer(2));
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBe(true);
  });

  it("returns true for a valid 1-frame single-still decode (256 bytes)", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => opaqueBuffer(1));
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBe(true);
  });

  it("returns false when any sampled pixel has alpha < 255 (transparent WebM)", async () => {
    const buf = opaqueBuffer(3);
    buf[3] = 200; // pixel 0 alpha byte < 255
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => buf);
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBe(false);
  });

  it("returns false when a mid-buffer alpha byte < 255", async () => {
    // Guards the stride: if the loop mistakenly used `i += 3` or started at
    // `i = 0`, this off-position byte wouldn't be checked as alpha.
    const buf = opaqueBuffer(3);
    buf[buf.length - 1] = 128; // final alpha byte
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => buf);
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBe(false);
  });

  it("returns undefined for a malformed byte count that is not a whole-frame multiple", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => Buffer.alloc(100, 0xff));
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBeUndefined();
  });

  it("returns undefined for a byte count exceeding 3 frames (over-decode / stray bytes)", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => Buffer.alloc(1024, 0xff));
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBeUndefined();
  });

  it("returns undefined for an empty decode buffer", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => Buffer.alloc(0));
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBeUndefined();
  });

  it("returns undefined when execFileSync throws (spawn / decode failure)", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(() => {
      throw new Error("ffmpeg exited with code 1");
    });
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBeUndefined();
  });

  it("returns undefined when findFFmpeg cannot locate the binary", async () => {
    const { sampledAlphaIsFullyOpaque } = await importWithMocks(
      () => opaqueBuffer(3), // never called on this path
      null,
    );
    expect(sampledAlphaIsFullyOpaque(FAKE_WEBM)).toBeUndefined();
  });

  it("passes the load-bearing decoder flags to ffmpeg (canonical VP9 alpha decode)", async () => {
    // Regression guard for the "default decoder discards VP9 alpha" trap.
    // Without `-c:v libvpx-vp9` BEFORE `-i`, the check would falsely report
    // alpha=255 on WebMs whose alpha is genuinely present.
    let capturedArgs: readonly string[] | undefined;
    const { sampledAlphaIsFullyOpaque } = await importWithMocks((_cmd, args) => {
      capturedArgs = args;
      return opaqueBuffer(3);
    });
    sampledAlphaIsFullyOpaque(FAKE_WEBM);
    expect(capturedArgs).toBeDefined();
    const argList = [...(capturedArgs ?? [])];
    const decoderIdx = argList.indexOf("-c:v");
    const inputIdx = argList.indexOf("-i");
    expect(decoderIdx).toBeGreaterThanOrEqual(0);
    expect(argList[decoderIdx + 1]).toBe("libvpx-vp9");
    expect(inputIdx).toBeGreaterThan(decoderIdx);
    expect(argList).toContain("-pix_fmt");
    expect(argList[argList.indexOf("-pix_fmt") + 1]).toBe("rgba");
    expect(argList).toContain("-frames:v");
    expect(argList[argList.indexOf("-frames:v") + 1]).toBe("3");
    expect(argList).toContain("rawvideo");
  });
});

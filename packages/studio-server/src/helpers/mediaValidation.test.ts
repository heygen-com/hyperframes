import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { validateUploadedMedia, validateUploadedMediaBuffer } from "./mediaValidation.js";

describe("validateUploadedMedia", () => {
  it("passes through non-media files", () => {
    expect(
      validateUploadedMedia("/tmp/test.svg", () => ({ status: 0, stdout: "", stderr: "" })),
    ).toEqual({
      ok: true,
    });
  });

  it("accepts video files with a video stream", () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
      stderr: "",
    }));

    expect(validateUploadedMedia("/tmp/test.mp4", runner)).toEqual({ ok: true });
    expect(runner).toHaveBeenCalledWith(
      expect.stringMatching(/ffprobe/),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("rejects video files with no supported video stream", () => {
    expect(
      validateUploadedMedia("/tmp/test.mp4", () => ({
        status: 0,
        stdout: JSON.stringify({ streams: [] }),
        stderr: "",
      })),
    ).toEqual({ ok: false, reason: "no supported video stream found" });
  });

  it.each(["/tmp/test.flac", "/tmp/test.m4v"])(
    "probes %s instead of passing it through",
    (path) => {
      expect(
        validateUploadedMedia(path, () => ({
          status: 0,
          stdout: JSON.stringify({ streams: [] }),
          stderr: "",
        })),
      ).toMatchObject({ ok: false });
    },
  );

  it("accepts audio files with an audio stream", () => {
    expect(
      validateUploadedMedia("/tmp/test.wav", () => ({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }),
        stderr: "",
      })),
    ).toEqual({ ok: true });
  });

  it("accepts the upload but says it was not checked when ffprobe is unavailable", () => {
    expect(
      validateUploadedMedia("/tmp/test.mp4", () => ({
        status: null,
        stdout: "",
        stderr: "",
        error: { code: "ENOENT" } as NodeJS.ErrnoException,
      })),
    ).toEqual({ ok: true, unchecked: expect.stringMatching(/ffprobe was not found/) });
  });

  describe("with HYPERFRAMES_FFPROBE_PATH", () => {
    const configured = process.env.HYPERFRAMES_FFPROBE_PATH;
    const dir = mkdtempSync(join(tmpdir(), "hf-ffprobe-path-"));
    afterEach(() => {
      if (configured === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
      else process.env.HYPERFRAMES_FFPROBE_PATH = configured;
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("runs the ffprobe it names", () => {
      const ffprobe = join(dir, "ffprobe");
      writeFileSync(ffprobe, "");
      process.env.HYPERFRAMES_FFPROBE_PATH = ffprobe;
      const runner = vi.fn(() => ({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
        stderr: "",
      }));

      expect(validateUploadedMedia("/tmp/test.mp4", runner)).toEqual({ ok: true });
      expect(runner).toHaveBeenCalledWith(ffprobe, expect.any(Array), expect.anything());
    });

    it("rejects the upload, naming the setting, when the ffprobe it names cannot run", () => {
      const missing = join(dir, "missing-ffprobe");
      process.env.HYPERFRAMES_FFPROBE_PATH = missing;

      expect(validateUploadedMedia("/tmp/test.mp4")).toEqual({
        ok: false,
        reason: expect.stringContaining(`HYPERFRAMES_FFPROBE_PATH names "${missing}"`),
      });
    });
  });
});

describe("validateUploadedMediaBuffer", () => {
  it("validates media from a temp file that preserves the extension", () => {
    let inspectedPath = "";
    expect(
      validateUploadedMediaBuffer("raycast.mp4", new Uint8Array([0, 1, 2]), (_command, args) => {
        inspectedPath = args.at(-1) ?? "";
        return {
          status: 0,
          stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
          stderr: "",
        };
      }),
    ).toEqual({ ok: true });

    expect(inspectedPath).toMatch(/raycast\.mp4$/);
  });
});

import { describe, expect, it } from "vitest";
import { validateUploadedMedia } from "./mediaValidation.js";

describe("validateUploadedMedia", () => {
  it("passes through non-media files", () => {
    expect(
      validateUploadedMedia("/tmp/test.svg", () => ({ status: 0, stdout: "", stderr: "" })),
    ).toEqual({
      ok: true,
    });
  });

  it("accepts video files with a video stream", () => {
    expect(
      validateUploadedMedia("/tmp/test.mp4", () => ({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
        stderr: "",
      })),
    ).toEqual({ ok: true });
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

  it("accepts audio files with an audio stream", () => {
    expect(
      validateUploadedMedia("/tmp/test.wav", () => ({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }),
        stderr: "",
      })),
    ).toEqual({ ok: true });
  });

  it("does not block upload when ffprobe is unavailable", () => {
    expect(
      validateUploadedMedia("/tmp/test.mp4", () => ({
        status: null,
        stdout: "",
        stderr: "",
        error: { code: "ENOENT" } as NodeJS.ErrnoException,
      })),
    ).toEqual({ ok: true });
  });
});

import { describe, expect, it } from "vitest";
import { codecsForFormat } from "./codecs.js";
import { mediaLocalTime } from "./mediaSeek.js";
import { suggestedFilename } from "./download.js";
import type { ExportResult } from "./types.js";

describe("codecsForFormat", () => {
  it("maps mp4 to avc/aac and webm to vp9/opus", () => {
    expect(codecsForFormat("mp4")).toEqual({
      video: "avc",
      audio: "aac",
      mimeType: "video/mp4",
      extension: "mp4",
    });
    expect(codecsForFormat("webm")).toEqual({
      video: "vp9",
      audio: "opus",
      mimeType: "video/webm",
      extension: "webm",
    });
  });
});

describe("mediaLocalTime", () => {
  it("offsets composition time by clip start and media trim", () => {
    expect(mediaLocalTime(2, 0.5, 3)).toBeCloseTo(1.5, 10);
    expect(mediaLocalTime(5, 0, 3)).toBe(-2);
  });
});

describe("suggestedFilename", () => {
  function result(overrides: Partial<ExportResult>): ExportResult {
    return {
      blob: new Blob([]),
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 5,
      frameCount: 150,
      compositionId: null,
      ...overrides,
    };
  }

  it("uses the composition id and mime-derived extension", () => {
    expect(suggestedFilename(result({ compositionId: "promo" }))).toBe("promo.mp4");
    expect(suggestedFilename(result({ mimeType: "video/webm" }))).toBe("composition.webm");
  });
});

import { describe, expect, it } from "vitest";
import { extractSafeRenderErrorCode } from "./server.js";
import { VideoExtractionStageError } from "./services/render/stages/extractVideosStage.js";

describe("extractSafeRenderErrorCode", () => {
  it("preserves allowlisted typed extraction codes", () => {
    const deterministic = new VideoExtractionStageError("VIDEO_SOURCE_UNRENDERABLE", false, [
      { kind: "invalid_media", count: 1 },
    ]);
    const exhausted = new VideoExtractionStageError("VIDEO_EXTRACTION_FAILED", true, [
      { kind: "ffmpeg_timeout", count: 1 },
    ]);

    expect(extractSafeRenderErrorCode(deterministic)).toBe("VIDEO_SOURCE_UNRENDERABLE");
    expect(extractSafeRenderErrorCode(exhausted)).toBe("VIDEO_EXTRACTION_FAILED");
  });

  it("accepts the same bounded structural code across wrapped module boundaries", () => {
    expect(extractSafeRenderErrorCode({ code: "VIDEO_SOURCE_UNRENDERABLE" })).toBe(
      "VIDEO_SOURCE_UNRENDERABLE",
    );
    expect(extractSafeRenderErrorCode({ code: "INVALID_VIDEO_METADATA" })).toBe(
      "INVALID_VIDEO_METADATA",
    );
  });

  it("does not forward arbitrary codes or parse message text", () => {
    expect(extractSafeRenderErrorCode({ code: "INTERNAL_ERROR" })).toBeUndefined();
    expect(
      extractSafeRenderErrorCode(new Error("failed [VIDEO_SOURCE_UNRENDERABLE; secret=/tmp/x]")),
    ).toBeUndefined();
  });
});

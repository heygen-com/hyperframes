import { describe, expect, it } from "vitest";
import { extractSafeRenderErrorCode, extractSafeRenderErrorMetadata } from "./server.js";
import { VideoExtractionStageError } from "./services/render/stages/extractVideosStage.js";
import { AssetMediaTypeMismatchError } from "./services/assetMediaType.js";
import { EncoderInterruptedError } from "./services/render/encoderInterruption.js";

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

  it("transports stable ownership and retry policy for media-type mismatches", () => {
    const error = new AssetMediaTypeMismatchError([
      { expected: "video", detected: "image", elementFingerprint: "0123456789abcdef" },
    ]);
    expect(extractSafeRenderErrorMetadata(error)).toEqual({
      errorCode: "ASSET_MEDIA_TYPE_MISMATCH",
      errorOwner: "user",
      retryable: false,
    });
  });

  it("transports the bounded encoder interruption contract", () => {
    const error = new EncoderInterruptedError("Encoding failed", "private ffmpeg stderr");
    expect(extractSafeRenderErrorMetadata(error)).toEqual({
      errorCode: "ENCODER_INTERRUPTED",
      errorOwner: "system",
      retryable: true,
    });
    expect(error.message).not.toContain("private ffmpeg stderr");
  });

  it("transports producer-authored public metadata without interpreting its schema", () => {
    const error = new VideoExtractionStageError(
      "VIDEO_EXTRACTION_FAILED",
      true,
      [{ kind: "download_transient", count: 1 }],
      {
        schemaVersion: 1,
        kindCounts: [{ kind: "download_transient", affectedElementCount: 1 }],
        groups: [
          {
            kind: "download_transient",
            affectedElementCount: 1,
            sourceFingerprint: `sha256:${"0".repeat(64)}`,
            host: "media.customer-cdn.example",
            statusClass: "http_5xx",
            retry: { phase: "download", used: 1, budget: 1 },
          },
        ],
        omittedGroupCount: 0,
      },
    );

    expect(extractSafeRenderErrorMetadata(error)).toEqual({
      errorCode: "VIDEO_EXTRACTION_FAILED",
      errorOwner: undefined,
      retryable: true,
      errorMetadata: error.publicMetadata,
    });
  });

  it("does not transport arbitrary private fields or non-object public metadata", () => {
    expect(
      extractSafeRenderErrorMetadata({
        code: "VIDEO_EXTRACTION_FAILED",
        retryable: true,
        publicMetadata: "https://media.example/private.mp4?signature=secret",
        localPath: "/tmp/private.mp4",
      }),
    ).toEqual({
      errorCode: "VIDEO_EXTRACTION_FAILED",
      errorOwner: undefined,
      retryable: true,
    });
  });

  it("does not forward arbitrary codes or parse message text", () => {
    expect(extractSafeRenderErrorCode({ code: "INTERNAL_ERROR" })).toBeUndefined();
    expect(
      extractSafeRenderErrorCode(new Error("failed [VIDEO_SOURCE_UNRENDERABLE; secret=/tmp/x]")),
    ).toBeUndefined();
  });
});

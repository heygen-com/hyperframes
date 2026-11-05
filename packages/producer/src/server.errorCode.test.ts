import { describe, expect, it } from "vitest";
import { extractSafeRenderErrorCode, extractSafeRenderErrorMetadata } from "./server.js";
import {
  assertVideoExtractionSucceeded,
  VideoExtractionStageError,
} from "./services/render/stages/extractVideosStage.js";
import type { ExtractionResult } from "@hyperframes/engine";
import { AssetMediaTypeMismatchError } from "./services/assetMediaType.js";
import { EncoderInterruptedError } from "./services/render/encoderInterruption.js";
import { RenderStageStalledError } from "./services/render/observability.js";

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

  it("says what ffmpeg said about an unrenderable source, and never its raw diagnostic", () => {
    const result = {
      success: false,
      extracted: [],
      totalFramesExtracted: 0,
      errors: [
        {
          videoId: "v1",
          kind: "ffmpeg_failed",
          retryable: false,
          error: "FFmpeg exited with code 1: /Users/someone/My Clip.mp4: Invalid data",
          ffmpegReason: "<path>: Invalid data found when processing input",
        },
      ],
    } as unknown as ExtractionResult;
    expect(() => assertVideoExtractionSucceeded(result)).toThrow(
      "Video extraction failed for 1 source(s) [VIDEO_SOURCE_UNRENDERABLE; ffmpeg_failed=1]: ffmpeg said: <path>: Invalid data found when processing input",
    );
    expect(() => assertVideoExtractionSucceeded(result)).not.toThrow("someone");
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

  it("transports the stalled-stage contract", () => {
    const error = new RenderStageStalledError("capture_disk", 60_000, 12);
    expect([error.code, error.owner, error.retryable]).toEqual([
      "RENDER_STAGE_STALLED",
      "system",
      false,
    ]);
    expect(extractSafeRenderErrorMetadata(error)).toEqual({
      errorCode: "RENDER_STAGE_STALLED",
      errorOwner: "system",
      retryable: false,
    });
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

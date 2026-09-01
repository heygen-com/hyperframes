import { describe, expect, it } from "vitest";
import { extractSafeRenderErrorCode, extractSafeRenderErrorMetadata } from "./server.js";
import { VideoExtractionStageError } from "./services/render/stages/extractVideosStage.js";
import { AssetMediaTypeMismatchError } from "./services/assetMediaType.js";
import { EncoderInterruptedError } from "./services/render/encoderInterruption.js";

function structuralExtractionError(extractionFailure: unknown): Record<string, unknown> {
  return {
    code: "VIDEO_EXTRACTION_FAILED",
    retryable: true,
    extractionFailure,
  };
}

function validStructuralExtractionFailure(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kindCounts: [{ kind: "download_transient", affectedElementCount: 1 }],
    groups: [
      {
        kind: "download_transient",
        affectedElementCount: 1,
        sourceFingerprint:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        host: "media.heygen.ai",
        statusClass: "http_5xx",
        retry: { phase: "download", used: 1, budget: 1 },
      },
    ],
    omittedGroupCount: 0,
  };
}

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
    expect(error.code).toBe("ASSET_MEDIA_TYPE_MISMATCH");
    expect(error.owner).toBe("user");
    expect(error.retryable).toBe(false);
    expect(extractSafeRenderErrorCode(error)).toBe("ASSET_MEDIA_TYPE_MISMATCH");
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

  it("transports bounded extraction metadata with the top-level retry policy", () => {
    const error = new VideoExtractionStageError(
      "VIDEO_EXTRACTION_FAILED",
      true,
      [{ kind: "download_transient", count: 2 }],
      {
        schemaVersion: 1,
        kindCounts: [{ kind: "download_transient", affectedElementCount: 2 }],
        groups: [
          {
            kind: "download_transient",
            affectedElementCount: 2,
            sourceFingerprint:
              "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            host: "media.heygen.ai",
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
      extractionFailure: error.extractionFailure,
    });
  });

  it("drops malformed extraction metadata instead of forwarding source-like fields", () => {
    expect(
      extractSafeRenderErrorMetadata({
        code: "VIDEO_EXTRACTION_FAILED",
        retryable: true,
        extractionFailure: {
          schemaVersion: 1,
          kindCounts: [{ kind: "download_transient", affectedElementCount: 1 }],
          groups: [
            {
              kind: "download_transient",
              affectedElementCount: 1,
              sourceFingerprint: "https://media.heygen.ai/private.mp4?signature=secret",
              host: "untrusted.example",
            },
          ],
          omittedGroupCount: 0,
        },
      }),
    ).toEqual({
      errorCode: "VIDEO_EXTRACTION_FAILED",
      errorOwner: undefined,
      retryable: true,
    });
  });

  it.each([
    [
      "oversized counts",
      {
        ...validStructuralExtractionFailure(),
        kindCounts: [{ kind: "download_transient", affectedElementCount: 10_001 }],
      },
    ],
    ["empty kind counts", { ...validStructuralExtractionFailure(), kindCounts: [] }],
    [
      "duplicate kind counts",
      {
        ...validStructuralExtractionFailure(),
        kindCounts: [
          { kind: "download_transient", affectedElementCount: 1 },
          { kind: "download_transient", affectedElementCount: 1 },
        ],
      },
    ],
    [
      "non-canonical group ordering",
      {
        ...validStructuralExtractionFailure(),
        kindCounts: [{ kind: "download_transient", affectedElementCount: 2 }],
        groups: [
          {
            kind: "download_transient",
            affectedElementCount: 1,
            sourceFingerprint: `sha256:${"f".repeat(64)}`,
          },
          {
            kind: "download_transient",
            affectedElementCount: 1,
            sourceFingerprint: `sha256:${"0".repeat(64)}`,
          },
        ],
      },
    ],
    [
      "too many groups",
      {
        ...validStructuralExtractionFailure(),
        kindCounts: [{ kind: "download_transient", affectedElementCount: 9 }],
        groups: Array.from({ length: 9 }, (_, index) => ({
          kind: "download_transient",
          affectedElementCount: 1,
          sourceFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
        })),
      },
    ],
    [
      "oversized omitted count",
      { ...validStructuralExtractionFailure(), omittedGroupCount: 10_001 },
    ],
    [
      "unknown fields",
      { ...validStructuralExtractionFailure(), rawSource: "https://example.test/private" },
    ],
  ])("drops %s at the structural trust boundary", (_description, extractionFailure) => {
    expect(extractSafeRenderErrorMetadata(structuralExtractionError(extractionFailure))).toEqual({
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

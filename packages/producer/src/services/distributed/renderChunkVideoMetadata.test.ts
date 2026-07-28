import { describe, expect, it } from "bun:test";
import {
  INVALID_VIDEO_METADATA,
  RenderChunkValidationError,
  validatePlanVideosForChunk,
} from "./renderChunk.js";

describe("v1 chunk video metadata boundary", () => {
  it("rejects legacy null timing before frame injection", () => {
    let caught: unknown;
    try {
      validatePlanVideosForChunk({
        videos: [
          {
            id: "hero",
            src: "hero.mp4",
            start: 0,
            end: null,
            mediaStart: 0,
            loop: false,
            hasAudio: false,
          },
        ],
        extracted: [],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RenderChunkValidationError);
    expect((caught as RenderChunkValidationError).code).toBe(INVALID_VIDEO_METADATA);
    expect((caught as Error).message).toContain("end must be a finite number");
  });
});

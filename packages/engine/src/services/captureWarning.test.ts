import { describe, expect, it } from "vitest";
import { cloneCaptureWarning } from "./captureWarning.js";

describe("cloneCaptureWarning", () => {
  it("deep-clones every mutable warning-detail array", () => {
    const source = {
      code: "audio_processing_failed" as const,
      message: "audio failed",
      details: {
        sources: ["voice.wav"],
        failureReasons: ["ffmpeg_timeout"],
        failureStages: ["prepare"],
      },
    };

    const clone = cloneCaptureWarning(source);
    clone.details.sources.push("clone-source.wav");
    clone.details.failureReasons.push("clone-reason");
    clone.details.failureStages.push("clone-stage");

    expect(source.details).toEqual({
      sources: ["voice.wav"],
      failureReasons: ["ffmpeg_timeout"],
      failureStages: ["prepare"],
    });
  });
});

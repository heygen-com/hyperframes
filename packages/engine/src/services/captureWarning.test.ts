import { describe, expect, it } from "vitest";
import type { CaptureWarning } from "../types.js";
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

it("isolates nested audio subprocess evidence in warning snapshots", () => {
  const source: CaptureWarning = {
    code: "audio_processing_failed",
    message: "failed",
    details: {
      audioFailures: [
        {
          stage: "prepare",
          reason: "ffmpeg_failed",
          owner: "system",
          retryable: false,
          subprocess: { exitCode: 7, terminationReason: "exit" },
        },
      ],
    },
  };
  const copy = cloneCaptureWarning(source);
  const evidence = copy.details?.audioFailures?.[0]?.subprocess;
  if (!evidence) throw new Error("missing copied evidence");
  evidence.exitCode = 8;
  copy.details?.audioFailures?.push({
    stage: "mix",
    reason: "internal",
    owner: "system",
    retryable: false,
  });
  expect(source.details?.audioFailures).toHaveLength(1);
  expect(source.details?.audioFailures?.[0]?.subprocess?.exitCode).toBe(7);
});

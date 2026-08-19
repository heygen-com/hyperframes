import { describe, expect, it } from "bun:test";
import {
  comparePlanParityMeasurements,
  type PlanParityMeasurement,
  type PlanParityProtocol,
} from "./plan-parity-contract.js";

function measurement(
  protocol: PlanParityProtocol,
  overrides: {
    frames?: string[];
    pcmSha?: string;
    duration?: number;
    outputSha?: string;
    outputBytes?: number;
    chunkSha?: string;
    transferBytes?: number;
    peakBytes?: number;
  } = {},
): PlanParityMeasurement {
  const transferBytes = overrides.transferBytes ?? 100;
  return {
    protocol,
    driver: "test",
    media: {
      outputSha256: overrides.outputSha ?? "encoded",
      outputBytes: overrides.outputBytes ?? 1000,
      frameSha256: overrides.frames ?? ["frame-0", "frame-1"],
      pcmAudio: {
        sha256: overrides.pcmSha ?? "pcm",
        sampleCount: 96_000,
        bytes: 384_000,
      },
      metadata: {
        video: {
          codecName: "h264",
          width: 320,
          height: 180,
          pixelFormat: "yuv420p",
          averageFrameRate: "30/1",
          realFrameRate: "30/1",
          frameCount: 60,
          colorSpace: "bt709",
          colorTransfer: "bt709",
          colorPrimaries: "bt709",
        },
        audio: {
          codecName: "aac",
          sampleRate: 48_000,
          channels: 2,
          channelLayout: "stereo",
        },
        durationSeconds: overrides.duration ?? 2,
      },
    },
    chunks: [
      {
        index: 0,
        sha256: overrides.chunkSha ?? "chunk",
        bytes: 500,
      },
    ],
    transferBytes: {
      downloaded: Math.floor(transferBytes / 2),
      uploaded: Math.ceil(transferBytes / 2),
      total: transferBytes,
    },
    peakMaterializedBytes: overrides.peakBytes ?? 2000,
  };
}

describe("comparePlanParityMeasurements()", () => {
  it("accepts semantic parity while only reporting encoded and transport differences", () => {
    const result = comparePlanParityMeasurements(
      measurement("v1", {
        outputSha: "container-v1",
        outputBytes: 1000,
        transferBytes: 10_000,
        peakBytes: 20_000,
      }),
      measurement("v2", {
        outputSha: "container-v2",
        outputBytes: 900,
        transferBytes: 5000,
        peakBytes: 6000,
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.checks.find((entry) => entry.name === "encoded-output")?.detail).toContain(
      "(reported)",
    );
    expect(result.checks.find((entry) => entry.name === "transfer-bytes")?.detail).toContain(
      "v1=10000",
    );
  });

  it("fails on decoded frame, PCM, metadata, duration, or chunk drift", () => {
    const cases: Array<[string, PlanParityMeasurement]> = [
      ["decoded-video-frames", measurement("v2", { frames: ["different"] })],
      ["canonical-pcm-audio", measurement("v2", { pcmSha: "different" })],
      [
        "ffprobe-stream-metadata",
        {
          ...measurement("v2"),
          media: {
            ...measurement("v2").media,
            metadata: {
              ...measurement("v2").media.metadata,
              video: {
                ...measurement("v2").media.metadata.video!,
                width: 640,
              },
            },
          },
        },
      ],
      ["ffprobe-duration", measurement("v2", { duration: 2.1 })],
      ["chunk-hashes", measurement("v2", { chunkSha: "different" })],
    ];

    for (const [expectedFailure, v2] of cases) {
      const result = comparePlanParityMeasurements(measurement("v1"), v2);
      expect(result.passed).toBe(false);
      expect(result.checks.find((entry) => entry.name === expectedFailure)?.passed).toBe(false);
    }
  });

  it("can enforce encoded equality and v2 resource ceilings", () => {
    const result = comparePlanParityMeasurements(
      measurement("v1"),
      measurement("v2", {
        outputSha: "different",
        transferBytes: 101,
        peakBytes: 201,
      }),
      {
        requireEncodedOutputEquality: true,
        maxV2TransferBytes: 100,
        maxV2PeakMaterializedBytes: 200,
      },
    );

    expect(result.passed).toBe(false);
    expect(result.checks.filter((entry) => !entry.passed).map((entry) => entry.name)).toEqual([
      "encoded-output",
      "transfer-bytes",
      "peak-materialized-working-set",
    ]);
  });

  it("rejects reversed or same-protocol comparisons", () => {
    expect(() => comparePlanParityMeasurements(measurement("v2"), measurement("v1"))).toThrow(
      /ordered v1\/v2/,
    );
    expect(() => comparePlanParityMeasurements(measurement("v1"), measurement("v1"))).toThrow(
      /ordered v1\/v2/,
    );
  });

  it("does not expose or compare planHash", () => {
    const result = comparePlanParityMeasurements(measurement("v1"), measurement("v2"));
    expect(JSON.stringify(result)).not.toContain("planHash");
  });
});

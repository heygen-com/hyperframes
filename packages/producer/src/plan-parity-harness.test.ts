import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import type { PlanParityDriver, PlanParityMeasurement } from "./plan-parity-contract.js";
import {
  classifyPlanTooLargeProbeFailure,
  parsePlanParityArgs,
  runPlanV2SizePressure,
} from "./plan-parity-harness.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const target of cleanup.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function fakeV2Measurement(): PlanParityMeasurement {
  return {
    protocol: "v2",
    driver: "fake-lambda-local",
    media: {
      outputSha256: "output",
      outputBytes: 123,
      frameSha256: ["frame"],
      pcmAudio: null,
      metadata: {
        video: null,
        audio: null,
        durationSeconds: 1,
      },
    },
    chunks: [],
    transferBytes: {
      downloaded: 10,
      uploaded: 20,
      total: 30,
    },
    peakMaterializedBytes: 40,
  };
}

describe("parsePlanParityArgs()", () => {
  it("defaults both explicit protocol runs to lambda-local", () => {
    const options = parsePlanParityArgs(["node", "plan-parity"]);
    expect(options.v1Target).toBe("lambda-local");
    expect(options.v2Target).toBe("lambda-local");
    expect(options.renderConfig).toMatchObject({
      fps: 30,
      width: 320,
      height: 180,
      format: "mp4",
    });
    expect(options.expectV1PlanTooLarge).toBe(false);
  });

  it("parses resource gates and a low v1 size cap", () => {
    const options = parsePlanParityArgs([
      "node",
      "plan-parity",
      "--v1-plan-size-cap-bytes=32768",
      "--max-v2-transfer-bytes",
      "1048576",
      "--max-v2-peak-materialized-bytes",
      "524288",
      "--strict-encoded-output=false",
      "--chunk-size",
      "15",
      "--expect-v1-plan-too-large",
    ]);
    expect(options.v1PlanSizeCapBytes).toBe(32_768);
    expect(options.comparison.maxV2TransferBytes).toBe(1_048_576);
    expect(options.comparison.maxV2PeakMaterializedBytes).toBe(524_288);
    expect(options.comparison.requireEncodedOutputEquality).toBe(false);
    expect(options.renderConfig.chunkSize).toBe(15);
    expect(options.expectV1PlanTooLarge).toBe(true);
  });

  it("reserves an explicit deployed-AWS target grammar", () => {
    const options = parsePlanParityArgs([
      "node",
      "plan-parity",
      "--v1-target",
      "aws:hf-plan-v1-test",
      "--v2-target",
      "aws:hf-plan-v2-test",
    ]);
    expect(options.v1Target).toBe("aws:hf-plan-v1-test");
    expect(options.v2Target).toBe("aws:hf-plan-v2-test");
  });

  it("rejects bad targets and numeric flags", () => {
    expect(() => parsePlanParityArgs(["node", "plan-parity", "--v2-target", "production"])).toThrow(
      /lambda-local or aws/,
    );
    expect(() =>
      parsePlanParityArgs(["node", "plan-parity", "--v1-plan-size-cap-bytes", "-1"]),
    ).toThrow(/positive integer/);
    expect(() => parsePlanParityArgs(["node", "plan-parity", "--fps", "25"])).toThrow(
      /24, 30, or 60/,
    );
    expect(() =>
      parsePlanParityArgs(["node", "plan-parity", "--duration-tolerance-seconds", "not-a-number"]),
    ).toThrow(/non-negative finite number/);
  });
});

describe("runPlanV2SizePressure()", () => {
  it("records typed v1 PLAN_TOO_LARGE and still completes explicit v2", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "hf-plan-pressure-fixture-"));
    const artifactsDir = mkdtempSync(join(tmpdir(), "hf-plan-pressure-report-"));
    cleanup.push(fixtureDir, artifactsDir);
    writeFileSync(join(fixtureDir, "index.html"), "<html></html>", "utf-8");
    const calls: string[] = [];
    const driver: PlanParityDriver = {
      name: "fake-lambda-local",
      async render(input) {
        calls.push(input.protocol);
        if (input.protocol === "v1") {
          const error = new Error("synthetic cap exceeded") as Error & {
            code: "PLAN_TOO_LARGE";
            sizeBytes: number;
            limitBytes: number;
          };
          error.code = "PLAN_TOO_LARGE";
          error.sizeBytes = 65_536;
          error.limitBytes = 32_768;
          throw error;
        }
        return {
          protocol: "v2",
          outputPath: join(input.outputDir, "output.mp4"),
          chunks: [],
          transferBytes: { downloaded: 10, uploaded: 20 },
          peakMaterializedBytes: 40,
        };
      },
    };

    const report = await runPlanV2SizePressure({
      fixtureDir,
      artifactsDir,
      driver,
      renderConfig: {
        fps: 30,
        width: 320,
        height: 180,
        format: "mp4",
      },
      v1PlanSizeCapBytes: 32_768,
      analyzeDriverResult: async () => fakeV2Measurement(),
    });

    expect(calls).toEqual(["v1", "v2"]);
    expect(report.passed).toBe(true);
    expect(report.v1).toEqual({
      status: "expected-failure",
      code: "PLAN_TOO_LARGE",
      message: "synthetic cap exceeded",
      sizeBytes: 65_536,
      limitBytes: 32_768,
    });
    expect(report.v2.status).toBe("success");
    const written = JSON.parse(
      readFileSync(join(artifactsDir, "plan-too-large-v2-report.json"), "utf-8"),
    ) as {
      passed: boolean;
      v1: { code: string };
      v2: { status: string };
    };
    expect(written).toMatchObject({
      passed: true,
      v1: { code: "PLAN_TOO_LARGE" },
      v2: { status: "success" },
    });
  });

  it("distinguishes non-PLAN_TOO_LARGE failures", () => {
    const error = new Error("network down") as Error & { code: string };
    error.code = "S3_UNAVAILABLE";
    expect(classifyPlanTooLargeProbeFailure(error)).toEqual({
      status: "unexpected-failure",
      code: "S3_UNAVAILABLE",
      message: "network down",
    });
  });
});

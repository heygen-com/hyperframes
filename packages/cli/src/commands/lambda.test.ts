import { afterEach, describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";

const mocks = vi.hoisted(() => ({
  defaultCloudFps: vi.fn(() => 24),
  runDeploy: vi.fn(async () => undefined),
  runRender: vi.fn(async () => undefined),
  runRenderBatch: vi.fn(async () => undefined),
}));

vi.mock("../utils/compositionFps.js", () => ({ defaultCloudFps: mocks.defaultCloudFps }));
vi.mock("@hyperframes/aws-lambda/sdk", () => ({}));
vi.mock("./lambda/deploy.js", () => ({ runDeploy: mocks.runDeploy }));
vi.mock("./lambda/render.js", () => ({ runRender: mocks.runRender }));
vi.mock("./lambda/render-batch.js", () => ({ runRenderBatch: mocks.runRenderBatch }));

import lambdaCommand from "./lambda.js";

const malformedFps = [
  "30.5",
  "30fps",
  "nope",
  " 30",
  "30 ",
  "+30",
  "3e1",
  "0x1e",
  "30000/1001",
  "9".repeat(400),
];

async function runLambda(args: Record<string, unknown>): Promise<unknown> {
  return lambdaCommand.run?.({ args, rawArgs: [], cmd: lambdaCommand } as never);
}

async function expectUsage(args: Record<string, unknown>, flagName: string, raw: string) {
  const error = await runLambda(args).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CliUsageError);
  expect((error as Error).message).toContain(flagName);
  expect((error as Error).message).toContain(JSON.stringify(raw));
}

function renderArgs(subcommand: "render" | "render-batch"): Record<string, unknown> {
  return {
    subcommand,
    target: "project",
    width: "1920",
    height: "1080",
    ...(subcommand === "render-batch" ? { batch: "batch.jsonl" } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.defaultCloudFps.mockReset().mockReturnValue(24);
});

describe("Lambda distributed integer flags", () => {
  it.each(["render", "render-batch"] as const)(
    "keeps %s dimensions required and positive",
    async (subcommand) => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const key of ["width", "height"] as const) {
        const missing = renderArgs(subcommand);
        delete missing[key];
        const missingError = await runLambda(missing).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(missingError).toBeInstanceOf(CliUsageError);

        for (const raw of ["0", "-1"]) {
          const rangeError = await runLambda({ ...renderArgs(subcommand), [key]: raw }).then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(rangeError).toBeInstanceOf(CliUsageError);
          expect((rangeError as Error).message).toContain(`--${key}`);
          expect((rangeError as Error).message).toContain(raw);
        }
      }
      expect(stderr).toHaveBeenCalled();
      expect(mocks.runRender).not.toHaveBeenCalled();
      expect(mocks.runRenderBatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["render", "--width", "width", "1920.5"],
    ["render", "--height", "height", "1920px"],
    ["render", "--chunk-size", "chunk-size", "nope"],
    ["render", "--max-parallel-chunks", "max-parallel-chunks", "1920.5"],
    ["render", "--target-chunk-frames", "target-chunk-frames", "1920px"],
    ["render", "--wait-interval-ms", "wait-interval-ms", "nope"],
    ["render-batch", "--width", "width", "1920.5"],
    ["render-batch", "--height", "height", "1920px"],
    ["render-batch", "--chunk-size", "chunk-size", "nope"],
    ["render-batch", "--max-parallel-chunks", "max-parallel-chunks", "1920.5"],
    ["render-batch", "--target-chunk-frames", "target-chunk-frames", "1920px"],
    ["render-batch", "--max-concurrent", "max-concurrent", "nope"],
  ] as const)("rejects %s %s=%s before delegation", async (subcommand, _flag, key, raw) => {
    const args = renderArgs(subcommand);
    args[key] = raw;
    await expectUsage(args, `--${key}`, raw);
    expect(mocks.runRender).not.toHaveBeenCalled();
    expect(mocks.runRenderBatch).not.toHaveBeenCalled();
  });

  it.each(["render", "render-batch"] as const)(
    "keeps empty %s dimensions required",
    async (subcommand) => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const key of ["width", "height"] as const) {
        const error = await runLambda({ ...renderArgs(subcommand), [key]: "" }).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(CliUsageError);
      }
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining("--width and --height are required"),
      );
      expect(mocks.runRender).not.toHaveBeenCalled();
      expect(mocks.runRenderBatch).not.toHaveBeenCalled();
    },
  );

  it("treats an empty optional deploy memory as omitted", async () => {
    await runLambda({ subcommand: "deploy", memory: "" });
    expect(mocks.runDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ lambdaMemoryMb: undefined }),
    );
  });

  it("treats empty optional render integers as omitted", async () => {
    await runLambda({
      ...renderArgs("render"),
      fps: "",
      "chunk-size": "",
      "max-parallel-chunks": "",
      "target-chunk-frames": "",
      "wait-interval-ms": "",
    });
    expect(mocks.defaultCloudFps).toHaveBeenCalledWith("project");
    expect(mocks.runRender).toHaveBeenCalledWith(
      expect.objectContaining({
        fps: 24,
        chunkSize: undefined,
        maxParallelChunks: undefined,
        targetChunkFrames: undefined,
        waitIntervalMs: 5000,
      }),
    );

    mocks.runRenderBatch.mockClear();
    await runLambda({
      ...renderArgs("render-batch"),
      fps: "",
      "max-concurrent": "",
    });
    expect(mocks.runRenderBatch).toHaveBeenCalledWith(
      expect.objectContaining({ fps: 24, maxConcurrent: undefined }),
    );
  });

  it("rejects malformed deploy memory before invoking the deploy runner", async () => {
    const raw = "1024.5";
    await expectUsage({ subcommand: "deploy", memory: raw }, "--memory", raw);
    expect(mocks.runDeploy).not.toHaveBeenCalled();
  });

  it.each(["render", "render-batch"] as const)(
    "rejects every malformed FPS token for %s without composition fallback or delegation",
    async (subcommand) => {
      for (const raw of malformedFps) {
        mocks.defaultCloudFps.mockClear();
        mocks.runRender.mockClear();
        mocks.runRenderBatch.mockClear();
        await expectUsage({ ...renderArgs(subcommand), fps: raw }, "--fps", raw);
        expect(mocks.defaultCloudFps).not.toHaveBeenCalled();
        expect(mocks.runRender).not.toHaveBeenCalled();
        expect(mocks.runRenderBatch).not.toHaveBeenCalled();
      }
    },
  );

  it("preserves accepted integer tokens, FPS validation, omission and defaults", async () => {
    mocks.defaultCloudFps.mockReturnValue(24);
    for (const fps of [24, 25, 30, 60]) {
      mocks.runRender.mockClear();
      await runLambda({
        ...renderArgs("render"),
        width: "01920",
        height: "01080",
        fps: String(fps),
      });
      expect(mocks.runRender).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1920, height: 1080, fps }),
      );
    }
    expect(mocks.defaultCloudFps).not.toHaveBeenCalled();

    mocks.runRender.mockClear();
    await runLambda({ ...renderArgs("render"), width: "01920", height: "01080", fps: "030" });
    expect(mocks.runRender).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1920, height: 1080, fps: 30 }),
    );

    mocks.runRender.mockClear();
    await runLambda(renderArgs("render"));
    expect(mocks.defaultCloudFps).toHaveBeenCalledWith("project");
    expect(mocks.runRender).toHaveBeenCalledWith(
      expect.objectContaining({
        fps: 24,
        chunkSize: undefined,
        maxParallelChunks: undefined,
        targetChunkFrames: undefined,
        waitIntervalMs: 5000,
      }),
    );

    mocks.runRender.mockClear();
    mocks.defaultCloudFps.mockReturnValue(30);
    await runLambda(renderArgs("render"));
    expect(mocks.runRender).toHaveBeenCalledWith(expect.objectContaining({ fps: 30 }));

    mocks.runRender.mockClear();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unsupported = await runLambda({ ...renderArgs("render"), fps: "7" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(unsupported).toBeInstanceOf(CliUsageError);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("--fps must be one of"));
    expect(mocks.runRender).not.toHaveBeenCalled();
  });

  it("leaves omitted deploy and batch tuning options to their existing defaults", async () => {
    await runLambda({ subcommand: "deploy" });
    expect(mocks.runDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ lambdaMemoryMb: undefined }),
    );

    await runLambda({ ...renderArgs("render-batch"), batch: "batch.jsonl", "dry-run": true });
    expect(mocks.runRenderBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkSize: undefined,
        maxParallelChunks: undefined,
        targetChunkFrames: undefined,
        maxConcurrent: undefined,
        dryRun: true,
      }),
    );
  });
});

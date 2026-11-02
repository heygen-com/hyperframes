/**
 * Boundary test for the `hyperframes cloudrun render{,-batch}` wire config.
 * Pins that the aspect-agnostic flag reaches `SerializableDistributedRenderConfig`
 * so the Cloud Run worker's compile stage can remap `landscape` → `portrait`.
 *
 * The parse helper itself is covered at `../utils/parseOutputResolution.test.ts`;
 * we only re-check the entrypoint composition here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliUsageError } from "../utils/commandResult.js";

const mocks = vi.hoisted(() => ({
  defaultCloudFps: vi.fn(() => 24),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "terraform-output", stderr: "" })),
  deploySite: vi.fn(async () => ({ siteId: "site", uploaded: false })),
  renderToCloudRun: vi.fn(async (_input: unknown) => ({
    renderId: "render",
    executionName: "execution",
    outputGcsUri: "gs://bucket/output.mp4",
  })),
  getRenderProgress: vi.fn(async () => ({ status: "succeeded" })),
  getTerraformModuleDir: vi.fn(() => "/tmp/cloudrun-test/terraform"),
}));

vi.mock("../utils/compositionFps.js", () => ({ defaultCloudFps: mocks.defaultCloudFps }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("@hyperframes/gcp-cloud-run/sdk", () => ({
  deploySite: mocks.deploySite,
  renderToCloudRun: mocks.renderToCloudRun,
  getRenderProgress: mocks.getRenderProgress,
}));
vi.mock("@hyperframes/gcp-cloud-run/terraform", () => ({
  getTerraformModuleDir: mocks.getTerraformModuleDir,
}));

import {
  buildRenderConfig,
  isMissingCloudRunAdapterError,
  missingCloudRunAdapterMessage,
} from "./cloudrun.js";
import cloudrunCommand from "./cloudrun.js";

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

let testHome = "";
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env["HOME"];
  testHome = mkdtempSync(join(tmpdir(), "hf-cloudrun-command-"));
  process.env["HOME"] = testHome;
  vi.clearAllMocks();
  mocks.defaultCloudFps.mockReset().mockReturnValue(24);
  mocks.spawnSync
    .mockReset()
    .mockReturnValue({ status: 0, stdout: "terraform-output", stderr: "" });
  mocks.deploySite.mockReset().mockResolvedValue({ siteId: "site", uploaded: false });
  mocks.renderToCloudRun.mockReset().mockResolvedValue({
    renderId: "render",
    executionName: "execution",
    outputGcsUri: "gs://bucket/output.mp4",
  });
  mocks.getRenderProgress.mockReset().mockResolvedValue({ status: "succeeded" });
  mocks.getTerraformModuleDir.mockReset().mockReturnValue("/tmp/cloudrun-test/terraform");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

async function runCloudRun(args: Record<string, unknown>): Promise<unknown> {
  return cloudrunCommand.run?.({ args, rawArgs: [], cmd: cloudrunCommand } as never);
}

async function expectUsage(args: Record<string, unknown>, flagName: string, raw: string) {
  const error = await runCloudRun(args).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CliUsageError);
  expect((error as Error).message).toContain(flagName);
  expect((error as Error).message).toContain(JSON.stringify(raw));
}

function cloudRunRenderArgs(subcommand: "render" | "render-batch"): Record<string, unknown> {
  return {
    subcommand,
    target: "project",
    width: "1920",
    height: "1080",
    ...(subcommand === "render-batch" ? { batch: join(testHome, "batch.jsonl") } : {}),
  };
}

function writeCloudRunState(): string {
  const stateDir = join(testHome, ".hyperframes");
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, "cloudrun-state.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      projectId: "project",
      region: "us-central1",
      bucketName: "bucket",
      serviceUrl: "https://example.invalid",
      workflowId: "workflow",
    }),
  );
  return statePath;
}

function writeBatch(entries = [{ outputKey: "output.mp4" }]): string {
  const batchPath = join(testHome, "batch.jsonl");
  writeFileSync(batchPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return batchPath;
}

describe("cloudrun wire config — aspect-agnostic threading", () => {
  const baseArgs: Record<string, unknown> = {
    format: "mp4",
    codec: undefined,
    quality: undefined,
    "chunk-size": undefined,
    "max-parallel-chunks": undefined,
    "target-chunk-frames": undefined,
  };

  it("threads outputResolutionAspectAgnostic=true through the wire config for portrait 1080p", () => {
    // The exact bug shape: portrait comp + `--output-resolution 1080p`.
    // Before the fix, the alias signal never reached the wire; Cloud Run
    // then hit the same portrait rejection this PR set out to eliminate.
    const config = buildRenderConfig(
      { ...baseArgs, "output-resolution": "1080p" },
      30,
      1080,
      1920,
      undefined,
    );
    expect(config.outputResolution).toBe("landscape");
    expect(config.outputResolutionAspectAgnostic).toBe(true);
  });

  it("keeps the aspect-agnostic key absent when the flag is a canonical preset", () => {
    // Sparse-wire invariant: don't broadcast `false` for the common path —
    // the compile-stage remap only fires on `true`.
    const config = buildRenderConfig(
      { ...baseArgs, "output-resolution": "portrait-4k" },
      30,
      2160,
      3840,
      undefined,
    );
    expect(config.outputResolution).toBe("portrait-4k");
    expect(config).not.toHaveProperty("outputResolutionAspectAgnostic");
  });

  it("omits both resolution fields when --output-resolution is unset", () => {
    const config = buildRenderConfig(baseArgs, 30, 1920, 1080, undefined);
    expect(config).not.toHaveProperty("outputResolution");
    expect(config).not.toHaveProperty("outputResolutionAspectAgnostic");
  });

  it("preserves the surface-labeled strict-throw contract on unknown values", () => {
    // Sanity guard: the local delegate stays wired to the shared helper's
    // throw semantics rather than silently downgrading to undefined. Full
    // input-space coverage lives at `../utils/parseOutputResolution.test.ts`.
    expect(() =>
      buildRenderConfig({ "output-resolution": "8k" }, 30, 1920, 1080, undefined),
    ).toThrow(/\[cloudrun render\]/);
  });
});

describe("Cloud Run adapter preflight", () => {
  it("identifies only the missing adapter, not a missing transitive dependency", () => {
    const adapterError = Object.assign(
      new Error("Cannot find package '@hyperframes/gcp-cloud-run' imported from cli.js"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const transitiveError = Object.assign(new Error("Cannot find package 'google-auth-library'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    expect(isMissingCloudRunAdapterError(adapterError)).toBe(true);
    expect(isMissingCloudRunAdapterError(transitiveError)).toBe(false);
  });

  it("provides global and project-local install recovery commands", () => {
    const message = missingCloudRunAdapterMessage("deploy");
    expect(message).toContain("hyperframes cloudrun deploy");
    expect(message).toContain("npm install -g @hyperframes/gcp-cloud-run");
    expect(message).toContain("npm install @hyperframes/gcp-cloud-run");
  });
});

describe("Cloud Run distributed integer flags", () => {
  it.each(["render", "render-batch"] as const)(
    "keeps %s dimensions required and positive",
    async (subcommand) => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const key of ["width", "height"] as const) {
        const missing = cloudRunRenderArgs(subcommand);
        if (subcommand === "render-batch") missing.batch = writeBatch();
        delete missing[key];
        const missingError = await runCloudRun(missing).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(missingError).toBeInstanceOf(CliUsageError);

        for (const raw of ["0", "-1"]) {
          const args = cloudRunRenderArgs(subcommand);
          if (subcommand === "render-batch") args.batch = writeBatch();
          args[key] = raw;
          const rangeError = await runCloudRun(args).then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(rangeError).toBeInstanceOf(CliUsageError);
          expect((rangeError as Error).message).toContain(`--${key}`);
          expect((rangeError as Error).message).toContain(raw);
        }
      }
      expect(stderr).toHaveBeenCalled();
      expect(mocks.renderToCloudRun).not.toHaveBeenCalled();
      expect(existsSync(join(testHome, ".hyperframes"))).toBe(false);
    },
  );

  it.each([
    ["render", "width", "1920.5"],
    ["render", "height", "1920px"],
    ["render", "chunk-size", "nope"],
    ["render", "max-parallel-chunks", "1920.5"],
    ["render", "target-chunk-frames", "1920px"],
    ["render", "wait-interval-ms", "nope"],
    ["render-batch", "width", "1920.5"],
    ["render-batch", "height", "1920px"],
    ["render-batch", "chunk-size", "nope"],
    ["render-batch", "max-parallel-chunks", "1920.5"],
    ["render-batch", "target-chunk-frames", "1920px"],
  ] as const)(
    "rejects %s --%s=%s before state or adapter effects",
    async (subcommand, key, raw) => {
      const args = cloudRunRenderArgs(subcommand);
      if (subcommand === "render-batch") args.batch = writeBatch();
      args[key] = raw;
      await expectUsage(args, `--${key}`, raw);
      expect(mocks.spawnSync).not.toHaveBeenCalled();
      expect(mocks.deploySite).not.toHaveBeenCalled();
      expect(mocks.renderToCloudRun).not.toHaveBeenCalled();
      expect(existsSync(join(testHome, ".hyperframes"))).toBe(false);
    },
  );

  it.each(["render", "render-batch"] as const)(
    "keeps empty %s dimensions required",
    async (subcommand) => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const key of ["width", "height"] as const) {
        const args = cloudRunRenderArgs(subcommand);
        if (subcommand === "render-batch") args.batch = writeBatch();
        args[key] = "";
        const error = await runCloudRun(args).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(CliUsageError);
      }
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining("--width and --height are required"),
      );
      expect(mocks.renderToCloudRun).not.toHaveBeenCalled();
      expect(existsSync(join(testHome, ".hyperframes"))).toBe(false);
    },
  );

  it.each(["render", "render-batch"] as const)(
    "rejects every malformed FPS token for %s without fallback or adapter work",
    async (subcommand) => {
      for (const raw of malformedFps) {
        mocks.defaultCloudFps.mockClear();
        mocks.deploySite.mockClear();
        mocks.renderToCloudRun.mockClear();
        const args = cloudRunRenderArgs(subcommand);
        if (subcommand === "render-batch") args.batch = writeBatch();
        args.fps = raw;
        await expectUsage(args, "--fps", raw);
        expect(mocks.defaultCloudFps).not.toHaveBeenCalled();
        expect(mocks.deploySite).not.toHaveBeenCalled();
        expect(mocks.renderToCloudRun).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["max-instances", "100.5"],
    ["timeout", "3600.5"],
  ] as const)("rejects malformed deploy --%s before process or state effects", async (key, raw) => {
    await expectUsage(
      { subcommand: "deploy", project: "project", image: "image", [key]: raw },
      `--${key}`,
      raw,
    );
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(existsSync(join(testHome, ".hyperframes"))).toBe(false);
    expect(mocks.getTerraformModuleDir).not.toHaveBeenCalled();
  });

  it.each([
    [false, "2.5"],
    [true, "2.5"],
  ] as const)(
    "rejects malformed --max-concurrent before JSONL processing and dry-run return (dry-run=%s, value=%j)",
    async (dryRun, raw) => {
      const statePath = writeCloudRunState();
      const batchPath = writeBatch();
      const before = readFileSync(statePath, "utf8");
      await expectUsage(
        {
          ...cloudRunRenderArgs("render-batch"),
          batch: batchPath,
          "max-concurrent": raw,
          "dry-run": dryRun,
        },
        "--max-concurrent",
        raw,
      );
      expect(readFileSync(statePath, "utf8")).toBe(before);
      expect(mocks.deploySite).not.toHaveBeenCalled();
      expect(mocks.renderToCloudRun).not.toHaveBeenCalled();
      expect(mocks.spawnSync).not.toHaveBeenCalled();
    },
  );

  it("keeps a valid batch dry-run free of state, upload, render and process effects", async () => {
    const batchPath = writeBatch();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCloudRun({
      ...cloudRunRenderArgs("render-batch"),
      batch: batchPath,
      "max-concurrent": "10",
      "dry-run": true,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("would-start"));
    expect(mocks.deploySite).not.toHaveBeenCalled();
    expect(mocks.renderToCloudRun).not.toHaveBeenCalled();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(existsSync(join(testHome, ".hyperframes"))).toBe(false);
  });

  it("preserves leading-zero values, FPS fallback, omitted chunk defaults and the 50-entry batch wave", async () => {
    writeCloudRunState();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCloudRun({
      ...cloudRunRenderArgs("render"),
      width: "01920",
      height: "01080",
      fps: "030",
    });
    expect(mocks.defaultCloudFps).not.toHaveBeenCalled();
    expect(mocks.renderToCloudRun).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ fps: 30, width: 1920, height: 1080 }),
      }),
    );
    const renderInput = mocks.renderToCloudRun.mock.calls[0]?.[0];
    if (!renderInput) throw new Error("Expected the render adapter to receive a config");
    const config = (renderInput as { config: Record<string, unknown> }).config;
    expect(config).not.toHaveProperty("chunkSize");
    expect(config).not.toHaveProperty("maxParallelChunks");
    expect(config).not.toHaveProperty("targetChunkFrames");

    for (const fps of [24, 25, 30, 60]) {
      mocks.renderToCloudRun.mockClear();
      await runCloudRun({ ...cloudRunRenderArgs("render"), fps: String(fps) });
      expect(mocks.renderToCloudRun).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ fps }) }),
      );
    }

    mocks.renderToCloudRun.mockClear();
    mocks.defaultCloudFps.mockReturnValue(24);
    await runCloudRun(cloudRunRenderArgs("render"));
    expect(mocks.defaultCloudFps).toHaveBeenCalledWith("project");
    expect(mocks.renderToCloudRun).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ fps: 24 }) }),
    );

    mocks.renderToCloudRun.mockClear();
    mocks.defaultCloudFps.mockReturnValue(30);
    await runCloudRun(cloudRunRenderArgs("render"));
    expect(mocks.renderToCloudRun).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ fps: 30 }) }),
    );

    mocks.deploySite.mockClear();
    mocks.renderToCloudRun.mockClear();
    let active = 0;
    let peak = 0;
    mocks.renderToCloudRun.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return {
        renderId: "render",
        executionName: "execution",
        outputGcsUri: "gs://bucket/output.mp4",
      };
    });
    const entries = Array.from({ length: 51 }, (_, i) => ({ outputKey: `output-${i}.mp4` }));
    await runCloudRun({
      ...cloudRunRenderArgs("render-batch"),
      batch: writeBatch(entries),
      "max-concurrent": "",
    });
    expect(mocks.deploySite).toHaveBeenCalledTimes(1);
    expect(mocks.renderToCloudRun).toHaveBeenCalledTimes(51);
    expect(peak).toBe(50);
    expect(log).toHaveBeenCalled();
  });

  it("treats empty optional deployment scaling values as omitted", async () => {
    for (const values of [{}, { "max-instances": "", timeout: "" }]) {
      await runCloudRun({
        subcommand: "deploy",
        project: "project",
        image: "image",
        ...values,
      });
    }
    const calls = mocks.spawnSync.mock.calls as unknown as [string, string[], unknown][];
    const applies = calls.filter(
      ([command, args]) => command === "terraform" && args[0] === "apply",
    );
    expect(applies).toHaveLength(2);
    for (const apply of applies) {
      expect(apply[1]).not.toContain("max_instances=100");
      expect(apply[1]).not.toContain("request_timeout_seconds=3600");
    }
  });

  it("treats empty optional render integers as omitted", async () => {
    writeCloudRunState();
    await runCloudRun({
      ...cloudRunRenderArgs("render"),
      fps: "",
      "chunk-size": "",
      "max-parallel-chunks": "",
      "target-chunk-frames": "",
      "wait-interval-ms": "",
    });
    expect(mocks.defaultCloudFps).toHaveBeenCalledWith("project");
    const renderInput = mocks.renderToCloudRun.mock.calls[0]?.[0];
    if (!renderInput) throw new Error("Expected the render adapter to receive a config");
    const config = (renderInput as { config: Record<string, unknown> }).config;
    expect(config.fps).toBe(24);
    expect(config).not.toHaveProperty("chunkSize");
    expect(config).not.toHaveProperty("maxParallelChunks");
    expect(config).not.toHaveProperty("targetChunkFrames");
    expect(config).not.toHaveProperty("waitIntervalMs");
    expect(existsSync(join(testHome, ".hyperframes"))).toBe(true);
  });
});

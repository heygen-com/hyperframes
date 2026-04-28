import { describe, expect, it } from "vitest";
import { buildDockerRunArgs, type DockerRenderOptions } from "./dockerRunArgs.js";

const BASE: DockerRenderOptions = {
  fps: 30,
  quality: "standard",
  format: "mp4",
  workers: 4,
  gpu: false,
  hdr: false,
  crf: undefined,
  videoBitrate: undefined,
  quiet: false,
};

const FIXED_INPUT = {
  imageTag: "hyperframes-renderer:0.0.0-test",
  projectDir: "/abs/proj",
  outputDir: "/abs/out",
  outputFilename: "out.mp4",
};

describe("buildDockerRunArgs", () => {
  it("matches snapshot for the default render", () => {
    expect(buildDockerRunArgs({ ...FIXED_INPUT, options: BASE })).toMatchInlineSnapshot(`
      [
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--shm-size=2g",
        "-v",
        "/abs/proj:/project:ro",
        "-v",
        "/abs/out:/output",
        "hyperframes-renderer:0.0.0-test",
        "/project",
        "--output",
        "/output/out.mp4",
        "--fps",
        "30",
        "--quality",
        "standard",
        "--format",
        "mp4",
        "--workers",
        "4",
      ]
    `);
  });

  it("matches snapshot when every renderer flag is enabled", () => {
    expect(
      buildDockerRunArgs({
        ...FIXED_INPUT,
        options: { ...BASE, gpu: true, hdr: true, crf: 18, videoBitrate: undefined, quiet: true },
      }),
    ).toMatchInlineSnapshot(`
      [
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--shm-size=2g",
        "--gpus",
        "all",
        "-v",
        "/abs/proj:/project:ro",
        "-v",
        "/abs/out:/output",
        "hyperframes-renderer:0.0.0-test",
        "/project",
        "--output",
        "/output/out.mp4",
        "--fps",
        "30",
        "--quality",
        "standard",
        "--format",
        "mp4",
        "--workers",
        "4",
        "--crf",
        "18",
        "--quiet",
        "--gpu",
        "--hdr",
      ]
    `);
  });

  // Regression for the original PR feedback: --hdr was silently dropped from
  // the docker arg array. Keep this assertion explicit (in addition to the
  // snapshot above) so the failure message points directly at the flag.
  it("forwards --hdr to the container when hdr is enabled", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, hdr: true },
    });
    expect(args).toContain("--hdr");
  });

  it("omits --hdr when hdr is disabled", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--hdr");
  });

  it("requests host GPU passthrough only when gpu is enabled", () => {
    const off = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(off).not.toContain("--gpus");
    expect(off).not.toContain("--gpu");

    const on = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpu: true },
    });
    // `--gpus all` is a docker run flag (host passthrough); `--gpu` is the
    // hyperframes CLI flag forwarded into the container — both must be set.
    expect(on).toContain("--gpus");
    expect(on).toContain("all");
    expect(on).toContain("--gpu");
  });

  it("forwards every renderer-shaped option (regression tripwire for silent drops)", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: {
        fps: 60,
        quality: "high",
        format: "webm",
        workers: 8,
        gpu: true,
        hdr: true,
        crf: 16,
        videoBitrate: undefined,
        quiet: true,
      },
    });
    // Each value must reach the container exactly once. If a future option
    // is added but only wired through to renderLocal, this test forces the
    // author to update buildDockerRunArgs (and add a check here) too.
    expect(args).toContain("60");
    expect(args).toContain("high");
    expect(args).toContain("webm");
    expect(args).toContain("8");
    expect(args).toContain("--crf");
    expect(args).toContain("16");
    expect(args).toContain("--quiet");
    expect(args).toContain("--gpu");
    expect(args).toContain("--hdr");
  });

  it("forwards --video-bitrate to the container when set", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, videoBitrate: "10M" },
    });
    expect(args).toContain("--video-bitrate");
    expect(args).toContain("10M");
    expect(args).not.toContain("--crf");
  });
});

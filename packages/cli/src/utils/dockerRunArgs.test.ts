import { describe, expect, it } from "vitest";
import { buildDockerRunArgs, type DockerRenderOptions } from "./dockerRunArgs.js";

const BASE: DockerRenderOptions = {
  fps: 30,
  quality: "standard",
  format: "mp4",
  workers: 4,
  gpu: false,
  gpuCapture: false,
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
        options: {
          ...BASE,
          gpu: true,
          gpuCapture: true,
          hdr: true,
          crf: 18,
          videoBitrate: undefined,
          quiet: true,
        },
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
        "--gpu-capture",
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

  // Forwarding gap caught in PR #471 review: --gpu-capture is plumbed
  // through host env (process.env.HYPERFRAMES_GPU_CAPTURE), which the
  // container never sees. The containerized CLI must receive the flag
  // explicitly so it can re-export the env var inside the container before
  // its engine workers spawn.
  it("forwards --gpu-capture to the container when gpuCapture is enabled", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpuCapture: true },
    });
    expect(args).toContain("--gpu-capture");
  });

  it("omits --gpu-capture when gpuCapture is disabled", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--gpu-capture");
  });

  it("--gpu-capture and --gpu forward independently into the container", () => {
    // The two CLI flags do separate things (NVENC encode vs hardware frame
    // capture) — each is forwarded on its own so the containerized CLI can
    // re-enable just the one the user asked for.
    const captureOnly = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpuCapture: true },
    });
    expect(captureOnly).toContain("--gpu-capture");
    expect(captureOnly).not.toContain("--gpu");

    const encodeOnly = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpu: true },
    });
    expect(encodeOnly).toContain("--gpu");
    expect(encodeOnly).not.toContain("--gpu-capture");
  });

  // Footgun caught in PR #471 review: --gpu-capture without --gpu used to
  // forward the flag into the container but never request host GPU passthrough,
  // so Chromium silently fell back to swiftshader. Either flag on its own
  // implies `--gpus all` now.
  it("requests host GPU passthrough when --gpu OR --gpu-capture is enabled", () => {
    const off = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(off).not.toContain("--gpus");

    const encodeOnly = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpu: true },
    });
    expect(encodeOnly).toContain("--gpus");
    expect(encodeOnly).toContain("all");

    const captureOnly = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpuCapture: true },
    });
    expect(captureOnly).toContain("--gpus");
    expect(captureOnly).toContain("all");

    // `--gpus all` should appear exactly once even when both flags are set.
    const both = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, gpu: true, gpuCapture: true },
    });
    expect(both.filter((a) => a === "--gpus")).toHaveLength(1);
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
        gpuCapture: true,
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
    expect(args).toContain("--gpu-capture");
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

import { describe, expect, it } from "vitest";
import { buildDockerRunArgs, type DockerRenderOptions } from "./dockerRunArgs.js";

const BASE: DockerRenderOptions = {
  fps: { num: 30, den: 1 },
  quality: "standard",
  format: "mp4",
  gpu: false,
  browserGpu: false,
  hdrMode: "auto",
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
        "--no-browser-gpu",
      ]
    `);
  });

  it("omits --workers when auto sizing should happen inside the container", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--workers");
  });

  it("matches snapshot when every renderer flag is enabled", () => {
    expect(
      buildDockerRunArgs({
        ...FIXED_INPUT,
        options: {
          ...BASE,
          gpu: true,
          hdrMode: "force-hdr",
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
        "--crf",
        "18",
        "--quiet",
        "--gpu",
        "--no-browser-gpu",
        "--hdr",
      ]
    `);
  });

  // Regression for the original PR feedback: --hdr was silently dropped from
  // the docker arg array. Keep this assertion explicit (in addition to the
  // snapshot above) so the failure message points directly at the flag.
  it("forwards --hdr to the container when hdrMode is force-hdr", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, hdrMode: "force-hdr" },
    });
    expect(args).toContain("--hdr");
    expect(args).not.toContain("--sdr");
  });

  it("forwards --sdr to the container when hdrMode is force-sdr", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, hdrMode: "force-sdr" },
    });
    expect(args).toContain("--sdr");
    expect(args).not.toContain("--hdr");
  });

  it("omits --hdr and --sdr when hdrMode is auto", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--hdr");
    expect(args).not.toContain("--sdr");
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

  it("forces software browser capture inside Docker", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).toContain("--no-browser-gpu");
  });

  it("forwards every renderer-shaped option (regression tripwire for silent drops)", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: {
        fps: { num: 60, den: 1 },
        quality: "high",
        format: "webm",
        workers: 8,
        gpu: true,
        browserGpu: false,
        hdrMode: "force-hdr",
        crf: 16,
        videoBitrate: undefined,
        quiet: true,
        entryFile: "compositions/intro.html",
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
    expect(args).toContain("--no-browser-gpu");
    expect(args).toContain("--hdr");
    expect(args).toContain("--composition");
    expect(args).toContain("compositions/intro.html");
  });

  it("forwards --format png-sequence to the container", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      outputFilename: "frames",
      options: { ...BASE, format: "png-sequence" },
    });
    const formatIdx = args.indexOf("--format");
    expect(formatIdx).toBeGreaterThanOrEqual(0);
    expect(args[formatIdx + 1]).toBe("png-sequence");
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

  it("forwards --variables JSON to the container when set", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, variables: { title: "Hello", n: 3 } },
    });
    const idx = args.indexOf("--variables");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('{"title":"Hello","n":3}');
  });

  it("omits --variables when none provided", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--variables");
  });

  it("omits --variables when payload is empty", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, variables: {} },
    });
    expect(args).not.toContain("--variables");
  });

  it("forwards --composition to the container when entryFile is set", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, entryFile: "compositions/intro.html" },
    });
    const idx = args.indexOf("--composition");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("compositions/intro.html");
  });

  it("omits --composition when entryFile is not set", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--composition");
  });

  it("forwards rational --fps verbatim (NTSC 30000/1001)", () => {
    // Regression for the fps fraction-syntax feature: the rational form must
    // survive the host → container hop as a single `30000/1001` argument so
    // the in-container CLI re-parses it as exact NTSC, not 29.97 decimal.
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, fps: { num: 30000, den: 1001 } },
    });
    const fpsIdx = args.indexOf("--fps");
    expect(fpsIdx).toBeGreaterThanOrEqual(0);
    expect(args[fpsIdx + 1]).toBe("30000/1001");
  });

  it("forwards integer --fps as a bare integer string", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, fps: { num: 60, den: 1 } },
    });
    const fpsIdx = args.indexOf("--fps");
    expect(fpsIdx).toBeGreaterThanOrEqual(0);
    expect(args[fpsIdx + 1]).toBe("60");
  });

  it("forwards --resolution to the container when outputResolution is set", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, outputResolution: "landscape-4k" },
    });
    const idx = args.indexOf("--resolution");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("landscape-4k");
  });

  it("omits --resolution when outputResolution is not set", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--resolution");
  });

  it("forwards --no-page-side-compositing when pageSideCompositing is false", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, pageSideCompositing: false },
    });
    expect(args).toContain("--no-page-side-compositing");
  });

  it("omits --no-page-side-compositing when pageSideCompositing is not explicitly false", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--no-page-side-compositing");
  });
});

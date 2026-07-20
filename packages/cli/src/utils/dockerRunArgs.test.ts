import { describe, expect, it } from "vitest";
import {
  buildDockerRunArgs,
  resolveDockerPlatform,
  type DockerRenderOptions,
} from "./dockerRunArgs.js";

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
  // Pin platform in tests so snapshots are arch-independent (otherwise they
  // flip between linux/amd64 and linux/arm64 depending on the host running
  // the test).
  platform: "linux/amd64",
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
        vp9CpuUsed: 2,
        videoBitrate: undefined,
        videoFrameFormat: "png",
        quiet: true,
        debug: true,
        bestEffort: false,
        entryFile: "compositions/intro.html",
        experimentalFastCapture: true,
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
    expect(args).toContain("--vp9-cpu-used");
    expect(args).toContain("2");
    expect(args).toContain("--video-frame-format");
    expect(args).toContain("png");
    expect(args).toContain("--quiet");
    expect(args).toContain("--debug");
    expect(args).toContain("--no-best-effort");
    expect(args).toContain("--gpu");
    expect(args).toContain("--no-browser-gpu");
    expect(args).toContain("--hdr");
    expect(args).toContain("--composition");
    expect(args).toContain("compositions/intro.html");
    expect(args).toContain("--experimental-fast-capture");
  });

  it("forwards only an explicit strict-readiness opt-in", () => {
    const compatible = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, bestEffort: true },
    });
    expect(compatible).not.toContain("--best-effort");
    expect(compatible).not.toContain("--no-best-effort");

    const strict = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, bestEffort: false },
    });
    expect(strict).toContain("--no-best-effort");
  });

  it("forwards --experimental-fast-capture only when enabled", () => {
    const on = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, experimentalFastCapture: true },
    });
    expect(on).toContain("--experimental-fast-capture");

    const off = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, experimentalFastCapture: false },
    });
    expect(off).not.toContain("--experimental-fast-capture");

    const absent = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(absent).not.toContain("--experimental-fast-capture");
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

  it("forwards --format gif and --gif-loop to the container", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      outputFilename: "demo.gif",
      options: { ...BASE, format: "gif", gifLoop: 0 },
    });
    const formatIdx = args.indexOf("--format");
    const loopIdx = args.indexOf("--gif-loop");
    expect(formatIdx).toBeGreaterThanOrEqual(0);
    expect(args[formatIdx + 1]).toBe("gif");
    expect(loopIdx).toBeGreaterThanOrEqual(0);
    expect(args[loopIdx + 1]).toBe("0");
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

  it("forwards --video-frame-format to the container when set to png", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, videoFrameFormat: "png" },
    });
    expect(args).toContain("--video-frame-format");
    expect(args).toContain("png");
  });

  it("omits --video-frame-format when it is auto or unset", () => {
    expect(buildDockerRunArgs({ ...FIXED_INPUT, options: BASE })).not.toContain(
      "--video-frame-format",
    );
    expect(
      buildDockerRunArgs({
        ...FIXED_INPUT,
        options: { ...BASE, videoFrameFormat: "auto" },
      }),
    ).not.toContain("--video-frame-format");
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

  it("forwards --browser-timeout in seconds when pageNavigationTimeoutMs is set", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, pageNavigationTimeoutMs: 180_000 },
    });
    const idx = args.indexOf("--browser-timeout");
    expect(idx).toBeGreaterThan(-1);
    // CLI flag takes seconds; engine takes ms — the docker bridge converts
    // back to seconds so the in-container CLI re-parses it consistently.
    expect(args[idx + 1]).toBe("180");
  });

  it("omits --browser-timeout when pageNavigationTimeoutMs is not set", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--browser-timeout");
  });

  it("forwards protocol and player-ready timeouts without unit conversion", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: {
        ...BASE,
        protocolTimeoutMs: 240_000,
        playerReadyTimeoutMs: 90_000,
      },
    });

    expect(args).toContain("--protocol-timeout");
    expect(args[args.indexOf("--protocol-timeout") + 1]).toBe("240000");
    expect(args).toContain("--player-ready-timeout");
    expect(args[args.indexOf("--player-ready-timeout") + 1]).toBe("90000");
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

  it("forwards the RAW aspect-agnostic alias `1080p` verbatim (does not pre-normalize to `landscape`)", () => {
    // Miga R2 important note on PR #2529: Docker correctness now depends on
    // forwarding the raw alias string, not the canonical preset — the
    // in-container CLI re-runs `normalizeResolutionFlag` +
    // `isAspectAgnosticResolutionAlias` so aspect-agnostic aliases keep
    // their orientation-adaptive behavior. A future refactor that
    // silently substitutes the normalized preset here would restore the
    // portrait-only Docker failure this test pins against.
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, outputResolution: "1080p" },
    });
    const idx = args.indexOf("--resolution");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("1080p");
    // Belt-and-braces: the normalized preset name must NOT slip in as a
    // second value that would confuse citty parsing on the container side.
    expect(args).not.toContain("landscape");
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

  it("keeps Docker debug artifacts under the mounted output directory", () => {
    const args = buildDockerRunArgs({
      ...FIXED_INPUT,
      options: { ...BASE, debug: true },
    });
    const envIdx = args.indexOf("PRODUCER_RENDERS_DIR=/output/renders");
    const imageIdx = args.indexOf(FIXED_INPUT.imageTag);
    expect(envIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeLessThan(imageIdx);
    expect(args).toContain("--debug");
  });

  it("omits --no-page-side-compositing when pageSideCompositing is not explicitly false", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    expect(args).not.toContain("--no-page-side-compositing");
  });

  // Regression for #1193: an arm64 host (Apple Silicon) was being pinned to
  // linux/amd64, which forced qemu emulation of chrome-headless-shell and
  // produced either navigation timeouts or chrome SEGVs. Each host arch must
  // land in its native --platform value.
  it("emits linux/arm64 when host platform is arm64", () => {
    const args = buildDockerRunArgs({
      imageTag: "hyperframes-renderer:0.0.0-test",
      projectDir: "/abs/proj",
      outputDir: "/abs/out",
      outputFilename: "out.mp4",
      platform: "linux/arm64",
      options: BASE,
    });
    const idx = args.indexOf("--platform");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("linux/arm64");
  });

  it("emits linux/amd64 when platform is explicitly amd64", () => {
    const args = buildDockerRunArgs({ ...FIXED_INPUT, options: BASE });
    const idx = args.indexOf("--platform");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("linux/amd64");
  });
});

describe("resolveDockerPlatform", () => {
  it("maps arm64 hosts to linux/arm64", () => {
    expect(resolveDockerPlatform("arm64", {})).toBe("linux/arm64");
  });

  it("maps x64 hosts to linux/amd64", () => {
    expect(resolveDockerPlatform("x64", {})).toBe("linux/amd64");
  });

  it("treats unknown architectures as linux/amd64 (safe default)", () => {
    expect(resolveDockerPlatform("riscv64", {})).toBe("linux/amd64");
  });

  // Regression guard: the production call site is `resolveDockerPlatform()`
  // with no args. If a refactor drops either default parameter, every other
  // arch-mapping test would still pass — this one fails loudly.
  it("uses process.arch and process.env when called with no arguments", () => {
    const result = resolveDockerPlatform();
    // Must equal the explicit-arg form (env override notwithstanding, which
    // wouldn't be set in the test runner unless deliberately stubbed).
    const expected = process.env.HYPERFRAMES_DOCKER_PLATFORM
      ? process.env.HYPERFRAMES_DOCKER_PLATFORM
      : resolveDockerPlatform(process.arch, {});
    expect(result).toBe(expected);
  });

  it("honors HYPERFRAMES_DOCKER_PLATFORM override on an arm64 host (Rosetta-Node / parity-regen escape hatch)", () => {
    expect(resolveDockerPlatform("arm64", { HYPERFRAMES_DOCKER_PLATFORM: "linux/amd64" })).toBe(
      "linux/amd64",
    );
  });

  it("honors HYPERFRAMES_DOCKER_PLATFORM override on an amd64 host", () => {
    expect(resolveDockerPlatform("x64", { HYPERFRAMES_DOCKER_PLATFORM: "linux/arm64" })).toBe(
      "linux/arm64",
    );
  });

  it("trims whitespace from HYPERFRAMES_DOCKER_PLATFORM and ignores empty override", () => {
    expect(resolveDockerPlatform("arm64", { HYPERFRAMES_DOCKER_PLATFORM: "  linux/amd64  " })).toBe(
      "linux/amd64",
    );
    // Empty/whitespace-only override falls back to arch detection — important
    // for shells where `export FOO=""` would otherwise pin platform to "".
    expect(resolveDockerPlatform("arm64", { HYPERFRAMES_DOCKER_PLATFORM: "" })).toBe("linux/arm64");
    expect(resolveDockerPlatform("arm64", { HYPERFRAMES_DOCKER_PLATFORM: "   " })).toBe(
      "linux/arm64",
    );
  });
});

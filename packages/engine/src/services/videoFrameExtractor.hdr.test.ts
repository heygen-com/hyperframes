import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  extractAllVideoFrames,
  extractVideoFramesRange,
  type VideoElement,
  type ExtractionResult,
} from "./videoFrameExtractor.js";
import { extractVideoMetadata } from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { SCHEMA_PREFIX } from "./extractionCache.js";

// Pass-through, so a test can tell whether extraction ran ffmpeg.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...real, runFfmpeg: vi.fn(real.runFfmpeg) };
});

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const HAS_ZSCALE =
  HAS_FFMPEG &&
  /\szscale\s/.test(spawnSync("ffmpeg", ["-hide_banner", "-filters"]).stdout.toString());

type Rgb = [number, number, number];

const UI_FIXTURE_WIDTH = 240;
const UI_FIXTURE_HEIGHT = 160;

function pngChunkTypes(path: string): string[] {
  const bytes = readFileSync(path);
  const types: string[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
    types.push(bytes.toString("latin1", offset + 4, offset + 8));
  }
  return types;
}

function readFirstFramePixel(mediaPath: string, x: number, y: number): Rgb {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { maxBuffer: UI_FIXTURE_WIDTH * UI_FIXTURE_HEIGHT * 3 + 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg pixel decode failed: ${result.stderr.toString().slice(-400)}`);
  }

  const offset = (y * UI_FIXTURE_WIDTH + x) * 3;
  return [
    result.stdout[offset] ?? 0,
    result.stdout[offset + 1] ?? 0,
    result.stdout[offset + 2] ?? 0,
  ];
}

// Release builds print "version 8.1.3" or "n8.1.3"; master builds print "N-<number>" and are newer.
const FFPROBE_VERSION = spawnSync("ffprobe", ["-version"]).stdout?.toString() ?? "";
const FFPROBE_RELEASE = FFPROBE_VERSION.match(/version n?(\d+)\.(\d+)/)
  ?.slice(1)
  .map(Number);
const FFPROBE_READS_CONTAINER_TRANSFER =
  /version N-/.test(FFPROBE_VERSION) ||
  (FFPROBE_RELEASE !== undefined &&
    (FFPROBE_RELEASE[0]! > 8 || (FFPROBE_RELEASE[0] === 8 && FFPROBE_RELEASE[1]! >= 1)));

/** The colour probes run so far: first-frame reads, and SPS transfer reads of an HLG source. */
function colourProbeRuns() {
  const runs = vi
    .mocked(runFfmpeg)
    .mock.calls.map(([args]) => args)
    .filter((args) => args.some((arg) => /showinfo|trace_headers/.test(arg)));
  return {
    firstFrame: runs.filter((args) => args.includes("-frames:v")).length,
    keyframes: runs.filter((args) => args.includes("nokey")).length,
  };
}

function colourProbesSince(before: ReturnType<typeof colourProbeRuns>) {
  const now = colourProbeRuns();
  return {
    firstFrame: now.firstFrame - before.firstFrame,
    keyframes: now.keyframes - before.keyframes,
  };
}

describe.skipIf(!HAS_ZSCALE)("forced-SDR HDR extraction", () => {
  let fixtureDir = "";

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "hf-forced-sdr-tonemap-test-"));
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  }, 30_000);

  async function synthesizeHlgClip(
    path: string,
    vui = "colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9",
    transfer = "arib-std-b67",
  ): Promise<void> {
    const synthesized = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0xe0b080:s=64x64:r=1:d=1",
      "-vf",
      `zscale=pin=bt709:tin=bt709:min=bt709:p=bt2020:t=${transfer}:m=bt2020nc:r=tv,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-color_primaries",
      "bt2020",
      "-color_trc",
      transfer,
      "-colorspace",
      "bt2020nc",
      "-bsf:v",
      `h264_metadata=${vui}`,
      path,
    ]);
    if (!synthesized.success) {
      throw new Error(`HLG fixture synthesis failed: ${synthesized.stderr.slice(-400)}`);
    }
  }

  it.each([
    [
      "HLG",
      "matrix",
      "arib-std-b67",
      "colour_primaries=9:transfer_characteristics=18:matrix_coefficients=2",
    ],
    [
      "HLG",
      "primaries",
      "arib-std-b67",
      "colour_primaries=2:transfer_characteristics=18:matrix_coefficients=9",
    ],
    [
      "HLG",
      "matrix and primaries",
      "arib-std-b67",
      "colour_primaries=2:transfer_characteristics=18:matrix_coefficients=2",
    ],
    [
      "PQ",
      "matrix and primaries",
      "smpte2084",
      "colour_primaries=2:transfer_characteristics=16:matrix_coefficients=2",
    ],
    [
      "HLG",
      "transfer",
      "arib-std-b67",
      "colour_primaries=9:transfer_characteristics=2:matrix_coefficients=9",
    ],
  ])(
    "tone-maps %s footage whose video stream has no %s tag like the fully tagged clip",
    async (name, missing, transfer, vui) => {
      const slug = `${name}-no-${missing}`.replace(/\W+/g, "-");
      const tagged = join(fixtureDir, `${name}-fully-tagged.mp4`);
      const untagged = join(fixtureDir, `${slug}.mp4`);
      const vuiTransfer = transfer === "smpte2084" ? 16 : 18;
      await synthesizeHlgClip(
        tagged,
        `colour_primaries=9:transfer_characteristics=${vuiTransfer}:matrix_coefficients=9`,
        transfer,
      );
      await synthesizeHlgClip(untagged, vui, transfer);
      const extract = (source: string, id: string) =>
        extractVideoFramesRange(source, id, 0, 1, {
          fps: 1,
          outputDir: join(fixtureDir, `out-${id}`),
          format: "png",
          toneMapHdrToSdr: true,
        });

      if (missing === "transfer") {
        // ffprobe before 8.1 reads the stream's unspecified transfer, so the clip is SDR there, as on main.
        if (!FFPROBE_READS_CONTAINER_TRANSFER) {
          await expect(extract(untagged, slug)).resolves.toBeDefined();
          return;
        }
        expect((await extractVideoMetadata(untagged)).colorSpace?.colorTransfer).toBe(transfer);
      }
      const reference = await extract(tagged, `ref-${slug}`);
      const result = await extract(untagged, slug);

      expect(readFileSync(result.framePaths.get(0)!)).toEqual(
        readFileSync(reference.framePaths.get(0)!),
      );
    },
    60_000,
  );

  it("probes each source's first frame once, however many cuts of it extract together", async () => {
    const sources = ["a", "b"].map((name) => join(fixtureDir, `cuts-${name}.mp4`));
    for (const source of sources) await synthesizeHlgClip(source);
    const probes = colourProbeRuns;
    const before = probes();
    await Promise.all(
      Array.from({ length: 12 }, (_, cut) =>
        extractVideoFramesRange(sources[cut % 2]!, `cut-${cut}`, 0, 1, {
          fps: 1,
          outputDir: join(fixtureDir, "cuts"),
          format: "png",
          toneMapHdrToSdr: true,
        }),
      ),
    );
    expect(colourProbesSince(before)).toEqual({ firstFrame: 2, keyframes: 2 });
  }, 60_000);

  it("probes a source again after its first-frame probe failed", async () => {
    const source = join(fixtureDir, "probe-retry.mp4");
    await synthesizeHlgClip(source);
    const probes = colourProbeRuns;
    const { runFfmpeg: real } =
      await vi.importActual<typeof import("../utils/runFfmpeg.js")>("../utils/runFfmpeg.js");
    vi.mocked(runFfmpeg).mockImplementation((args, opts) =>
      args.includes("showinfo")
        ? Promise.resolve({
            success: false,
            exitCode: 1,
            stderr: "",
            durationMs: 0,
            terminationReason: "exit",
          })
        : real(args, opts),
    );
    const extract = (id: string) =>
      extractVideoFramesRange(source, id, 0, 1, {
        fps: 1,
        outputDir: join(fixtureDir, "retry"),
        format: "png",
        toneMapHdrToSdr: true,
      });
    const before = probes();
    try {
      await extract("retry-failed");
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
    await extract("retry-again");
    expect(colourProbesSince(before)).toEqual({ firstFrame: 2, keyframes: 1 });
  }, 60_000);

  it("tone-maps an HLG source at HLG's white when a large header SEI follows its SPS", async () => {
    const source = join(fixtureDir, "hlg-x265-header.mp4");
    // x265 stores its settings as an SEI after the SPS in the file header; traced, it runs past 64 KB.
    // No B-frames: at 1 fps their reorder gap is a whole second, which Windows ffmpeg's mp4 muxer can refuse.
    const synthesized = await runFfmpeg([
      ...["-y", "-hide_banner", "-loglevel", "error"],
      ...["-f", "lavfi", "-i", "color=c=0xe0b080:s=64x64:r=1:d=1"],
      "-vf",
      "zscale=pin=bt709:tin=bt709:min=bt709:p=bt2020:t=arib-std-b67:m=bt2020nc:r=tv,format=yuv420p10le",
      ...[
        "-c:v",
        "libx265",
        "-x265-params",
        "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error:bframes=0",
      ],
      ...["-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc"],
      source,
    ]);
    if (!synthesized.success) {
      throw new Error(`x265 HLG fixture synthesis failed: ${synthesized.stderr.slice(-400)}`);
    }
    const before = vi.mocked(runFfmpeg).mock.calls.length;
    await extractVideoFramesRange(source, "hlg-x265-header", 0, 1, {
      fps: 1,
      outputDir: join(fixtureDir, "x265-header"),
      format: "png",
      toneMapHdrToSdr: true,
    });
    const toneMaps = vi
      .mocked(runFfmpeg)
      .mock.calls.slice(before)
      .flatMap(([args]) => args.filter((arg) => arg.includes("tonemap=")));
    expect(toneMaps).toHaveLength(1);
    expect(toneMaps[0]).toContain("npl=203");
  }, 60_000);

  it("reads an HLG source's keyframes again after that read failed", async () => {
    const source = join(fixtureDir, "keyframe-retry.mp4");
    await synthesizeHlgClip(source);
    const { runFfmpeg: real } =
      await vi.importActual<typeof import("../utils/runFfmpeg.js")>("../utils/runFfmpeg.js");
    vi.mocked(runFfmpeg).mockImplementation((args, opts) =>
      args.includes("nokey")
        ? Promise.resolve({
            success: false,
            exitCode: 1,
            stderr: "",
            durationMs: 0,
            terminationReason: "exit",
          })
        : real(args, opts),
    );
    const extract = (id: string) =>
      extractVideoFramesRange(source, id, 0, 1, {
        fps: 1,
        outputDir: join(fixtureDir, "keyframe-retry"),
        format: "png",
        toneMapHdrToSdr: true,
      });
    const before = colourProbeRuns();
    try {
      await extract("keyframes-failed");
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
    await extract("keyframes-again");
    expect(colourProbesSince(before)).toEqual({ firstFrame: 2, keyframes: 2 });
  }, 60_000);

  // One stream with HLG frames, then PQ frames: each is tone-mapped with its own transfer.
  it("tone-maps each frame of a mixed HLG and PQ stream with its own transfer", async () => {
    const segment = async (name: string, transfer: number) => {
      const path = join(fixtureDir, `mixed-${name}.h264`);
      const result = await runFfmpeg([
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=160x90:r=25:d=0.2",
        "-c:v",
        "libx264",
        // No B-frames: genpts stamps a raw stream in decode order, so reordered frames get wrong times.
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-bsf:v",
        `h264_metadata=colour_primaries=9:transfer_characteristics=${transfer}:matrix_coefficients=9`,
        "-f",
        "h264",
        path,
      ]);
      if (!result.success)
        throw new Error(`segment synthesis failed: ${result.stderr.slice(-400)}`);
      return readFileSync(path);
    };
    const mux = async (name: string, stream: Buffer) => {
      const raw = join(fixtureDir, `${name}.h264`);
      const path = join(fixtureDir, `${name}.mp4`);
      writeFileSync(raw, stream);
      const result = await runFfmpeg([
        ...["-y", "-v", "error", "-fflags", "+genpts", "-r", "25", "-f", "h264", "-i", raw],
        ...["-c", "copy", path],
      ]);
      if (!result.success) throw new Error(`mux failed: ${result.stderr.slice(-400)}`);
      return path;
    };
    const hlg = await segment("hlg", 18);
    const pq = await segment("pq", 16);
    const mixed = await mux("mixed-hlg-pq", Buffer.concat([hlg, pq]));
    const pqOnly = await mux("mixed-pq-only", pq);
    const extract = (source: string, id: string, duration: number) =>
      extractVideoFramesRange(source, id, 0, duration, {
        fps: 25,
        outputDir: join(fixtureDir, `out-${id}`),
        format: "png",
        toneMapHdrToSdr: true,
      });

    const mixedFrames = await extract(mixed, "mixed-hlg-pq", 0.4);
    const pqFrames = await extract(pqOnly, "mixed-pq-only", 0.2);

    expect(readFileSync(mixedFrames.framePaths.get(5)!)).toEqual(
      readFileSync(pqFrames.framePaths.get(0)!),
    );
  }, 60_000);

  // A stream-copy trim opens on edit-list pre-roll, which ffprobe counts as packets without frames.
  it("keeps per-frame tags in a mixed HLG and PQ file trimmed with a stream copy", async () => {
    const run = async (args: string[]) => {
      const result = await runFfmpeg(["-y", "-v", "error", ...args]);
      if (!result.success) throw new Error(`fixture failed: ${result.stderr.slice(-400)}`);
    };
    const segment = async (name: string, transfer: number) => {
      const path = join(fixtureDir, `trim-${name}.h264`);
      await run([
        ...["-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=2"],
        ...["-c:v", "libx264", "-g", "50", "-bf", "0"],
        ...["-pix_fmt", "yuv420p", "-bsf:v"],
        `h264_metadata=colour_primaries=9:transfer_characteristics=${transfer}:matrix_coefficients=9`,
        ...["-f", "h264", path],
      ]);
      return readFileSync(path);
    };
    const mux = async (name: string, stream: Buffer) => {
      const raw = join(fixtureDir, `${name}.h264`);
      const path = join(fixtureDir, `${name}.mp4`);
      writeFileSync(raw, stream);
      await run(["-fflags", "+genpts", "-r", "25", "-f", "h264", "-i", raw, "-c", "copy", path]);
      return path;
    };
    const pq = await segment("pq", 16);
    const mixed = await mux("trim-hlg-then-pq", Buffer.concat([await segment("hlg", 18), pq]));
    const pqOnly = await mux("trim-pq-only", pq);
    const trimmed = join(fixtureDir, "trim-from-hlg.mp4");
    await run(["-ss", "1", "-i", mixed, "-c", "copy", trimmed]);
    const extract = (source: string, id: string, start: number) =>
      extractVideoFramesRange(source, id, start, 0.04, {
        fps: 25,
        outputDir: join(fixtureDir, `out-${id}`),
        format: "png",
        toneMapHdrToSdr: true,
      });

    // Trimmed 1.6 s is the mixed file's 2.6 s: the PQ segment's 0.6 s.
    const fromTrim = await extract(trimmed, "trim-from-hlg", 1.6);
    const fromPq = await extract(pqOnly, "trim-pq-only", 0.6);

    const shown = readFirstFramePixel(fromTrim.framePaths.get(0)!, 40, 40);
    const expected = readFirstFramePixel(fromPq.framePaths.get(0)!, 40, 40);
    expect(Math.max(...shown.map((v, i) => Math.abs(v - expected[i]!)))).toBeLessThanOrEqual(2);
  }, 60_000);

  it("matches Studio's HLG tone map and isolates transformed cache entries", async () => {
    const source = join(fixtureDir, "hlg-warm.mp4");
    await synthesizeHlgClip(source);

    const reference = join(fixtureDir, "studio-reference.png");
    const referenceResult = await runFfmpeg([
      "-y",
      "-ss",
      "0",
      "-i",
      source,
      "-t",
      "1",
      "-vf",
      "fps=1,zscale=t=linear:npl=203,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv",
      "-q:v",
      "0",
      "-compression_level",
      "1",
      reference,
    ]);
    if (!referenceResult.success) {
      throw new Error(`Studio reference extraction failed: ${referenceResult.stderr.slice(-400)}`);
    }

    const cacheDir = join(fixtureDir, "cache");
    const video = (id: string): VideoElement => ({
      id,
      src: source,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });
    const extract = (id: string, toneMapHdrToSdr = false) =>
      extractAllVideoFrames(
        [video(id)],
        fixtureDir,
        {
          fps: 1,
          outputDir: join(fixtureDir, id),
          format: "png",
          toneMapHdrToSdr,
        },
        undefined,
        { extractCacheDir: cacheDir },
      );

    const plain = await extract("plain");
    const toneMapped = await extract("tone-mapped", true);
    const toneMappedAgain = await extract("tone-mapped-again", true);

    expect(plain.errors).toEqual([]);
    expect(toneMapped.errors).toEqual([]);
    expect(toneMapped.phaseBreakdown.cacheHits).toBe(0);
    expect(toneMapped.phaseBreakdown.cacheMisses).toBe(1);
    expect(toneMappedAgain.phaseBreakdown.cacheHits).toBe(1);
    expect(readdirSync(cacheDir).filter((name) => name.startsWith(SCHEMA_PREFIX))).toHaveLength(2);

    const frame = (result: ExtractionResult): Buffer => {
      const path = result.extracted[0]?.framePaths.get(0);
      if (!path) throw new Error("expected extracted frame");
      return readFileSync(path);
    };
    // Same pixels as Studio's tone map, declared as sRGB so Chrome shows them unconverted.
    const rgb = (path: string): Buffer =>
      spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .stdout;
    const toneMappedPath = toneMapped.extracted[0]!.framePaths.get(0)!;
    expect(rgb(toneMappedPath)).toEqual(rgb(reference));
    expect(pngChunkTypes(toneMappedPath)).toContain("sRGB");
    expect(pngChunkTypes(toneMappedPath)).not.toContain("cICP");
    expect(frame(plain)).not.toEqual(frame(toneMapped));

    const toneMappedJpg = await extractAllVideoFrames([video("tone-mapped-jpg")], fixtureDir, {
      fps: 1,
      outputDir: join(fixtureDir, "tone-mapped-jpg"),
      format: "jpg",
      toneMapHdrToSdr: true,
    });
    expect(toneMappedJpg.errors).toEqual([]);
    const jpgPixels = rgb(toneMappedJpg.extracted[0]!.framePaths.get(0)!);
    const referencePixels = rgb(reference);
    const worst = Math.max(...[...jpgPixels].map((v, i) => Math.abs(v - referencePixels[i]!)));
    expect(worst, "tone-mapped jpg against Studio's tone map").toBeLessThanOrEqual(3);
    expect(frame(toneMappedAgain)).toEqual(frame(toneMapped));

    // A macOS ffmpeg that has zscale uses the same tone map, not VideoToolbox.
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      const mac = await extractAllVideoFrames([video("tone-mapped-mac")], fixtureDir, {
        fps: 1,
        outputDir: join(fixtureDir, "tone-mapped-mac"),
        format: "png",
        toneMapHdrToSdr: true,
      });
      expect(mac.errors).toEqual([]);
      expect(rgb(mac.extracted[0]!.framePaths.get(0)!)).toEqual(rgb(reference));
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  }, 60_000);

  it("warns once and keeps VideoToolbox, under its own cache key, when a macOS ffmpeg has no zscale", async () => {
    const source = join(fixtureDir, "hlg-no-zscale.mp4");
    await synthesizeHlgClip(source);
    const cacheDir = join(fixtureDir, "no-zscale-cache");
    const clip = (id: string): VideoElement => ({
      id,
      src: source,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });
    const options = (id: string) => ({
      fps: 1,
      outputDir: join(fixtureDir, id),
      format: "png" as const,
      toneMapHdrToSdr: true,
    });
    const zscale = await extractAllVideoFrames(
      [clip("zscale")],
      fixtureDir,
      options("zscale"),
      undefined,
      {
        extractCacheDir: cacheDir,
      },
    );
    expect(zscale.errors).toEqual([]);

    const realPlatform = process.platform;
    vi.resetModules();
    vi.doMock("../utils/psnrFilterAvailability.js", () => ({
      isFfmpegFilterAvailable: async () => false,
      isPsnrFilterAvailable: async () => false,
    }));
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { extractAllVideoFrames: extractOnMac } = await import("./videoFrameExtractor.js");
      for (const [i, id] of ["no-zscale-1", "no-zscale-2"].entries()) {
        const result = await extractOnMac([clip(id)], fixtureDir, options(id), undefined, {
          extractCacheDir: cacheDir,
        });
        // The zscale frames above must not be served for the VideoToolbox path.
        if (i === 0) expect(result.phaseBreakdown.cacheHits).toBe(0);
        // Off macOS the VideoToolbox decode itself fails, which proves it was attempted.
        if (realPlatform !== "darwin")
          expect(JSON.stringify(result.errors)).toMatch(/videotoolbox/i);
      }
      const zscaleWarnings = stderr.mock.calls.filter(([message]) =>
        String(message).includes("no zscale filter"),
      );
      expect(zscaleWarnings).toHaveLength(1);
    } finally {
      stderr.mockRestore();
      Object.defineProperty(process, "platform", platform);
      vi.doUnmock("../utils/psnrFilterAvailability.js");
      vi.resetModules();
    }
  }, 60_000);

  // A second process would read the frames back without the HDR10 light-level metadata the tone map uses.
  it("tone-maps a VFR HDR10 window in one process, as the reference tone map would", async () => {
    const source = join(fixtureDir, "pq-vfr-4000nit.mp4");
    const synthesized = await runFfmpeg([
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0xf0e0c0:s=64x64:r=60:d=2",
      "-vf",
      "select='not(between(n\\,30\\,89))',zscale=pin=bt709:tin=bt709:min=bt709:p=bt2020:t=smpte2084:m=bt2020nc:r=tv:npl=1000,format=yuv420p10le",
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx265",
      "-x265-params",
      "log-level=error:hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:max-cll=4000,400:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(40000000,50)",
      source,
    ]);
    if (!synthesized.success)
      throw new Error(`PQ fixture synthesis failed: ${synthesized.stderr.slice(-400)}`);
    const referenceDir = join(fixtureDir, "pq-vfr-reference");
    mkdirSync(referenceDir, { recursive: true });
    const reference = await runFfmpeg([
      "-v",
      "error",
      "-ss",
      "0",
      "-i",
      source,
      "-t",
      "0.616666",
      "-vf",
      "zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,setparams=color_primaries=bt709:color_trc=iec61966-2-1",
      "-fps_mode",
      "cfr",
      "-r",
      "30",
      "-q:v",
      "0",
      "-compression_level",
      "1",
      join(referenceDir, "frame_%05d.png"),
    ]);
    expect(reference.success, reference.stderr).toBe(true);

    const result = await extractVideoFramesRange(source, "pq-vfr", 0, 0.616666, {
      fps: 30,
      outputDir: join(fixtureDir, "pq-vfr-out"),
      format: "png",
      toneMapHdrToSdr: true,
    });

    expect(result.metadata.isVFR).toBe(true);
    const referenceFrames = readdirSync(referenceDir).sort();
    // One slot per 30fps tick before 0.616666s; x265 packet durations cut the reference's still short.
    expect(result.totalFrames).toBe(19);
    expect(readFileSync(result.framePaths.get(0)!)).toEqual(
      readFileSync(join(referenceDir, referenceFrames[0]!)),
    );
  }, 60_000);
});

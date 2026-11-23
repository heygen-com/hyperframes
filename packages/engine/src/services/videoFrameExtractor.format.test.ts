import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  extractAllVideoFrames,
  extractVideoFramesRange,
  type VideoElement,
} from "./videoFrameExtractor.js";
import { extractVideoMetadata } from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// Pass-through, so a test can tell whether extraction ran ffmpeg.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...real, runFfmpeg: vi.fn(real.runFfmpeg) };
});

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const FFMPEG_ENCODERS = HAS_FFMPEG
  ? spawnSync("ffmpeg", ["-hide_banner", "-encoders"]).stdout.toString()
  : "";
// Homebrew's ffmpeg has libsvtav1 but not libaom-av1. Either one writes an untagged AV1 stream.
const AV1_ENCODER = ["libaom-av1", "libsvtav1"].find((name) =>
  new RegExp(`\\s${name}\\s`).test(FFMPEG_ENCODERS),
);

type Rgb = [number, number, number];

const UI_FIXTURE_WIDTH = 240;
const UI_FIXTURE_HEIGHT = 160;
const RED_SAMPLE_PIXELS = [
  [70, 72],
  [118, 82],
  [178, 92],
] as const;

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

function maxChannelDelta(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// Regression for saturated UI recordings: default JPEG extraction can shift
// high-chroma reds before browser capture. Forcing PNG should keep extracted
// source-video frames effectively identical to the decoded source pixels.
describe.skipIf(!HAS_FFMPEG)("video frame extraction format", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-video-frame-format-"));
  const UI_FIXTURE = join(FIXTURE_DIR, "ui-red.mp4");

  beforeAll(async () => {
    const result = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0xffe7ee:s=${UI_FIXTURE_WIDTH}x${UI_FIXTURE_HEIGHT}:d=1:r=1`,
      "-vf",
      "drawbox=x=44:y=58:w=152:h=44:color=0xdd382e@1:t=fill,drawbox=x=64:y=75:w=112:h=10:color=0xfff0f0@1:t=fill",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      UI_FIXTURE,
    ]);
    if (!result.success) {
      throw new Error(`UI color fixture synthesis failed: ${result.stderr.slice(-400)}`);
    }
  }, 30_000);

  afterAll(() => {
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }, 30_000);

  function fixtureVideo(): VideoElement {
    return {
      id: "ui",
      src: UI_FIXTURE,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };
  }

  it("extracts into a work directory whose name holds a printf code", async () => {
    const outDir = join(FIXTURE_DIR, "x 12% Up");
    mkdirSync(outDir, { recursive: true });
    const result = await extractAllVideoFrames([fixtureVideo()], FIXTURE_DIR, {
      fps: 1,
      outputDir: outDir,
    });
    expect(result.errors).toEqual([]);
    const frame = result.extracted[0]!.framePaths.get(0)!;
    expect(frame.startsWith(outDir)).toBe(true);
    expect(existsSync(frame)).toBe(true);
  });

  it("keeps the frames of a video whose id has parent segments inside the output directory", async () => {
    const outDir = join(FIXTURE_DIR, "id-path", "work", "frames");
    mkdirSync(outDir, { recursive: true });
    const result = await extractAllVideoFrames(
      [{ ...fixtureVideo(), id: "../../escaped" }],
      FIXTURE_DIR,
      { fps: 1, outputDir: outDir },
    );
    expect(result.errors).toEqual([]);
    const extracted = result.extracted[0]!;
    expect(dirname(extracted.outputDir)).toBe(outDir);
    expect(dirname(extracted.framePaths.get(0)!)).toBe(extracted.outputDir);
    expect(existsSync(join(FIXTURE_DIR, "id-path", "escaped"))).toBe(false);
  });

  it("keeps the rightmost 8 columns of a 1080-wide (16n + 8) jpg extraction", async () => {
    const source = join(FIXTURE_DIR, "white-1080.mp4");
    const synth = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=1080x16:d=1:r=1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "0",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    expect(synth.success).toBe(true);
    const outDir = join(FIXTURE_DIR, "out-white-1080");
    mkdirSync(outDir, { recursive: true });
    const result = await extractAllVideoFrames(
      [{ ...fixtureVideo(), id: "white", src: source }],
      FIXTURE_DIR,
      { fps: 1, outputDir: outDir },
    );
    expect(result.errors).toEqual([]);
    const frame = result.extracted[0]!.framePaths.get(0)!;
    expect(frame.endsWith(".jpg")).toBe(true);
    const lastColumns = (file: string) => [
      ...spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "format=gray,crop=8:1:iw-8:8",
        "-f",
        "rawvideo",
        "-",
      ]).stdout,
    ];
    const delivered = lastColumns(frame);
    const expected = lastColumns(source);
    expect(delivered).toHaveLength(8);
    for (const [i, v] of delivered.entries())
      expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(5);
  }, 60_000);

  async function proresFrame(name: string, pixFmt: string, profile: string, source: string) {
    const clip = join(FIXTURE_DIR, `${name}.mov`);
    const synth = await runFfmpeg(
      ["-y", "-loglevel", "error", "-f", "lavfi", "-i", source].concat([
        "-c:v",
        "prores_ks",
        "-profile:v",
        profile,
        "-pix_fmt",
        pixFmt,
        clip,
      ]),
    );
    expect(synth.success).toBe(true);
    const outDir = join(FIXTURE_DIR, `out-${name}`);
    mkdirSync(outDir, { recursive: true });
    const result = await extractAllVideoFrames(
      [{ ...fixtureVideo(), id: name, src: clip }],
      FIXTURE_DIR,
      { fps: 1, outputDir: outDir },
    );
    expect(result.errors).toEqual([]);
    return result.extracted[0]!.framePaths.get(0)!;
  }

  it("extracts ProRes without an alpha plane to jpg", async () => {
    const frame = await proresFrame("prores422", "yuv422p10le", "2", "testsrc2=s=320x180:d=1:r=1");
    expect(frame.endsWith(".jpg")).toBe(true);
  }, 60_000);

  it("keeps the alpha of ProRes 4444 exact in png frames", async () => {
    const frame = await proresFrame(
      "prores4444",
      "yuva444p10le",
      "4",
      "color=c=0x00ff00@0.5:s=320x180:d=1:r=1,format=yuva444p10le",
    );
    expect(frame.endsWith(".png")).toBe(true);
    const alpha = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      frame,
      "-vf",
      "alphaextract,crop=1:1:10:10",
      "-f",
      "rawvideo",
      "-",
    ]);
    expect(Math.abs(alpha.stdout[0]! - 128)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("keeps color-sensitive UI reds closer to source when extraction is forced to png", async () => {
    const defaultOut = join(FIXTURE_DIR, "out-default");
    const pngOut = join(FIXTURE_DIR, "out-png");
    mkdirSync(defaultOut, { recursive: true });
    mkdirSync(pngOut, { recursive: true });

    const defaultResult = await extractAllVideoFrames([fixtureVideo()], FIXTURE_DIR, {
      fps: 1,
      outputDir: defaultOut,
    });
    const pngResult = await extractAllVideoFrames([fixtureVideo()], FIXTURE_DIR, {
      fps: 1,
      outputDir: pngOut,
      format: "png",
    });

    expect(defaultResult.errors).toEqual([]);
    expect(pngResult.errors).toEqual([]);
    const defaultFrame = defaultResult.extracted[0]!.framePaths.get(0)!;
    const pngFrame = pngResult.extracted[0]!.framePaths.get(0)!;
    expect(defaultFrame.endsWith(".jpg")).toBe(true);
    expect(pngFrame.endsWith(".png")).toBe(true);

    let worstDefaultDelta = 0;
    let worstPngDelta = 0;
    for (const [x, y] of RED_SAMPLE_PIXELS) {
      const sourcePixel = readFirstFramePixel(UI_FIXTURE, x, y);
      worstDefaultDelta = Math.max(
        worstDefaultDelta,
        maxChannelDelta(sourcePixel, readFirstFramePixel(defaultFrame, x, y)),
      );
      worstPngDelta = Math.max(
        worstPngDelta,
        maxChannelDelta(sourcePixel, readFirstFramePixel(pngFrame, x, y)),
      );
    }

    expect(worstPngDelta).toBeLessThanOrEqual(5);
    expect(worstPngDelta).toBeLessThanOrEqual(worstDefaultDelta);
  }, 60_000);

  // Chrome runs with --force-color-profile=srgb and colour-manages any frame not tagged sRGB;
  // the SDR encoder writes the canvas code values as they are, so frames must reach it unconverted.
  it.each([
    ["BT.709", "bt709"],
    ["BT.601", "smpte170m"],
  ])(
    "declares png frames of a %s source as sRGB so Chrome shows their code values",
    async (name, tag) => {
      const fixture = join(FIXTURE_DIR, `${tag}-shadow.mp4`);
      const synth = await runFfmpeg([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x101010:s=${UI_FIXTURE_WIDTH}x${UI_FIXTURE_HEIGHT}:d=1:r=1`,
        "-vf",
        `setparams=color_primaries=${tag}:color_trc=${tag}:colorspace=${tag}:range=tv`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv420p",
        fixture,
      ]);
      if (!synth.success) {
        throw new Error(`${name} fixture synthesis failed: ${synth.stderr.slice(-400)}`);
      }
      expect((await extractVideoMetadata(fixture)).colorSpace?.colorTransfer).toBe(tag);
      const outputDir = join(FIXTURE_DIR, `out-png-transfer-${tag}`);
      mkdirSync(outputDir, { recursive: true });

      const result = await extractAllVideoFrames(
        [{ ...fixtureVideo(), id: tag, src: fixture }],
        FIXTURE_DIR,
        { fps: 1, outputDir, format: "png" },
      );

      expect(result.errors).toEqual([]);
      const frame = result.extracted[0]!.framePaths.get(0)!;
      // Chrome reads cICP before sRGB, and ffmpeg < 6.0 writes no cICP, so only an sRGB chunk
      // without cICP means "these are sRGB code values" on every ffmpeg.
      const chunks = pngChunkTypes(frame);
      expect(chunks).toContain("sRGB");
      expect(chunks).not.toContain("cICP");
      expect(readFirstFramePixel(frame, 10, 10)).toEqual(readFirstFramePixel(fixture, 10, 10));
    },
    60_000,
  );

  it("extracts jpg frames of a BT.709 source as the BT.601 full range JPEG readers assume", async () => {
    const fixture = join(FIXTURE_DIR, "bt709-patch.mp4");
    const synth = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0xC83C28:s=${UI_FIXTURE_WIDTH}x${UI_FIXTURE_HEIGHT}:d=1:r=1,format=rgb24,drawbox=x=31:y=0:w=64:h=${UI_FIXTURE_HEIGHT}:c=0x0000FE:t=fill`,
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "0",
      fixture,
    ]);
    if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr.slice(-400)}`);
    const outputDir = join(FIXTURE_DIR, "out-jpg-matrix");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [{ ...fixtureVideo(), id: "bt709-jpg", src: fixture }],
      FIXTURE_DIR,
      { fps: 1, outputDir, format: "jpg" },
    );

    expect(result.errors).toEqual([]);
    const frame = result.extracted[0]!.framePaths.get(0)!;
    // x=10 is flat colour; x=32 sits one pixel inside the blue edge.
    for (const x of [10, 32]) {
      const source = readFirstFramePixel(fixture, x, 10);
      const shown = readFirstFramePixel(frame, x, 10);
      const worst = Math.max(...shown.map((v, i) => Math.abs(v - source[i]!)));
      expect(worst, `x=${x}: source ${source} jpg ${shown}`).toBeLessThanOrEqual(3);
    }
  }, 60_000);

  // Measured in Chrome 152: untagged H.264 plays as BT.601 at 1280x718 and BT.709 at 1280x720 or 406x720;
  // untagged VP9 and AV1 play as BT.601 at every size.
  it.each([
    { codec: "libx264", height: 718, matrix: "bt601", format: "png" },
    { codec: "libx264", height: 718, matrix: "bt601", format: "jpg" },
    { codec: "libx264", height: 720, matrix: "bt709", format: "png" },
    { codec: "libx264", height: 720, matrix: "bt709", format: "jpg" },
    { codec: "libvpx-vp9", height: 720, matrix: "bt601", format: "png" },
    ...(AV1_ENCODER
      ? [{ codec: AV1_ENCODER, height: 720, matrix: "bt601", format: "png" } as const]
      : []),
  ] as const)(
    "reads an untagged $height-line $codec source as $matrix like Chrome's own playback ($format)",
    async ({ codec, height, matrix, format }) => {
      const extension = codec === "libvpx-vp9" ? "webm" : "mp4";
      const fixture = join(FIXTURE_DIR, `untagged-${codec}-${height}.${extension}`);
      const synth = await runFfmpeg([
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=0xC83C28:s=64x${height}:d=1:r=1`,
        "-vf",
        "scale=out_color_matrix=bt601:out_range=tv,format=yuv420p,setparams=colorspace=unknown:color_primaries=unknown:color_trc=unknown:range=tv",
        "-c:v",
        codec,
        ...(codec === "libx264" ? ["-qp", "0"] : ["-crf", "0", "-b:v", "0"]),
        ...(codec === "libaom-av1" ? ["-cpu-used", "8"] : []),
        fixture,
      ]);
      if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr.slice(-400)}`);
      expect((await extractVideoMetadata(fixture)).colorSpace?.colorSpace ?? "unknown").toBe(
        "unknown",
      );

      const result = await extractVideoFramesRange(
        fixture,
        `${basename(fixture)}-${format}`,
        0,
        1,
        {
          fps: 1,
          outputDir: join(FIXTURE_DIR, "out-untagged"),
          format,
        },
      );

      const pixelAt = (file: string, decode: string): number[] => [
        ...spawnSync("ffmpeg", [
          "-v",
          "error",
          "-i",
          file,
          "-vf",
          `${decode}format=rgb24,crop=1:1:10:10`,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-",
        ]).stdout,
      ];
      const expected = pixelAt(fixture, `scale=in_color_matrix=${matrix}:in_range=tv,`);
      const shown = pixelAt(result.framePaths.get(0)!, "");
      expect([expected.length, shown.length]).toEqual([3, 3]);
      const worst = Math.max(...shown.map((v, i) => Math.abs(v - expected[i]!)));
      expect(worst, `${matrix} decode ${expected}, ${format} ${shown}`).toBeLessThanOrEqual(
        format === "png" ? 1 : 3,
      );
    },
    60_000,
  );

  it("samples a 29.97 fps source with millisecond timestamps at 30 fps without skipping a frame", async () => {
    // Each frame writes its index as eight black or white blocks; the mp4 keeps 1/1000 s ticks.
    const fixture = join(FIXTURE_DIR, "ntsc-ms-ticks.mp4");
    const synth = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i"],
      "color=c=black:s=64x8:r=30000/1001:d=2,format=yuv420p,geq=lum='if(mod(floor(N/pow(2\\,floor(X/8)))\\,2)\\,235\\,16)':cb=128:cr=128",
      ...["-c:v", "libx264", "-qp", "0", "-g", "30", "-bf", "0", "-video_track_timescale", "1000"],
      fixture,
    ]);
    if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr.slice(-400)}`);

    const result = await extractVideoFramesRange(fixture, "ntsc-ms-ticks", 0, 1.5, {
      fps: 30,
      outputDir: join(FIXTURE_DIR, "out-ntsc-ms"),
      format: "png",
    });
    const indexOf = (file: string): number => {
      const row = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        "format=gray,crop=64:1:0:4",
        "-f",
        "rawvideo",
        "-",
      ]).stdout;
      return [...Array(8).keys()].reduce(
        (n, bit) => n + (row[bit * 8 + 4]! > 128 ? 1 << bit : 0),
        0,
      );
    };
    const shown = [...result.framePaths.keys()]
      .sort((a, b) => a - b)
      .map((i) => indexOf(result.framePaths.get(i)!));
    const steps = shown.slice(1).map((n, i) => n - shown[i]!);

    expect(shown.length).toBeGreaterThanOrEqual(44);
    expect(
      steps.filter((step) => step > 1),
      `source frames ${shown.join(",")}`,
    ).toEqual([]);
    expect(steps.filter((step) => step === 0).length).toBeLessThanOrEqual(1);
  }, 60_000);

  it("samples a millisecond-tick 29.97 fps source the same in segments as in one pass", async () => {
    const fixture = join(FIXTURE_DIR, "ntsc-ms-ticks-8s.mp4");
    const synth = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i"],
      "color=c=black:s=64x8:r=30000/1001:d=8,format=yuv420p,geq=lum='if(mod(floor(N/pow(2\\,floor(X/8)))\\,2)\\,235\\,16)':cb=128:cr=128",
      ...["-c:v", "libx264", "-qp", "0", "-g", "30", "-bf", "0", "-video_track_timescale", "1000"],
      fixture,
    ]);
    if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr.slice(-400)}`);
    const indexOf = (file: string): number => {
      const row = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        "format=gray,crop=64:1:0:4",
        "-f",
        "rawvideo",
        "-",
      ]).stdout;
      return [...Array(8).keys()].reduce(
        (n, bit) => n + (row[bit * 8 + 4]! > 128 ? 1 << bit : 0),
        0,
      );
    };
    const options = {
      fps: 30,
      outputDir: join(FIXTURE_DIR, "out-ntsc-seams"),
      format: "png" as const,
    };
    const single = await extractVideoFramesRange(fixture, "ntsc-single", 0, 7.5, options);

    const seams = [4, 17, 29, 41, 58, 73, 90, 107, 121, 139, 156, 170, 188, 201];
    const differing: string[] = [];
    for (const firstFrame of seams) {
      const segment = await extractVideoFramesRange(fixture, `ntsc-seam-${firstFrame}`, 0, 7.5, {
        ...options,
        frameRanges: [{ firstFrame, frames: 12 }],
      });
      for (const [slot, path] of segment.framePaths) {
        const expected = indexOf(single.framePaths.get(slot)!);
        const shown = indexOf(path);
        if (shown !== expected) differing.push(`slot ${slot}: ${shown} vs ${expected}`);
      }
    }
    expect(differing).toEqual([]);
  }, 120_000);

  // ffmpeg < 6.1 drops frame durations from CFR resampling once any -vf is set, so the colour
  // filters would cut the still that ends this window short.
  it.each([
    {
      name: "full range BT.709",
      format: "png",
      codec: "libx264",
      pixFmt: "yuvj420p",
      probed: { colorTransfer: "bt709" },
      tags: "range=pc:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
    },
    {
      name: "full range BT.709",
      format: "jpg",
      codec: "libx264",
      pixFmt: "yuvj420p",
      probed: { colorTransfer: "bt709" },
      tags: "range=pc:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
    },
    {
      name: "BT.470BG gamma 2.8",
      format: "png",
      codec: "libx264",
      pixFmt: "yuv420p",
      probed: { colorTransfer: "bt470bg" },
      tags: "color_primaries=bt470bg:color_trc=bt470bg:colorspace=bt470bg",
    },
    {
      name: "RGB",
      format: "png",
      codec: "libx264rgb",
      pixFmt: "rgb24",
      probed: { colorSpace: "gbr" },
      tags: "",
    },
  ] as const)(
    "keeps every frame and the colours of a $name VFR window that ends on a still ($format)",
    async ({ name, format, codec, pixFmt, probed, tags }) => {
      const fixture = join(FIXTURE_DIR, `vfr-still-${name.replace(/\W+/g, "-")}-${format}.mp4`);
      const synth = await runFfmpeg([
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=0xC83C28:s=${UI_FIXTURE_WIDTH}x${UI_FIXTURE_HEIGHT}:d=2:r=60`,
        "-vf",
        `select='not(between(n\\,30\\,89))'${tags ? `,setparams=${tags}` : ""}`,
        "-fps_mode",
        "vfr",
        "-c:v",
        codec,
        "-preset",
        "ultrafast",
        "-pix_fmt",
        pixFmt,
        fixture,
      ]);
      if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr.slice(-400)}`);
      const window = 0.616666;
      const unfilteredDir = join(FIXTURE_DIR, `out-${basename(fixture)}-unfiltered`);
      mkdirSync(unfilteredDir, { recursive: true });
      const unfiltered = await runFfmpeg([
        "-v",
        "error",
        "-ss",
        "0",
        "-i",
        fixture,
        "-t",
        String(window),
        "-fps_mode",
        "cfr",
        "-r",
        "30",
        join(unfilteredDir, "f_%05d.png"),
      ]);
      expect(unfiltered.success).toBe(true);

      const result = await extractVideoFramesRange(fixture, basename(fixture), 0, window, {
        fps: 30,
        outputDir: join(FIXTURE_DIR, "out-vfr-still"),
        format,
      });

      expect(result.metadata.isVFR).toBe(true);
      expect(result.metadata.colorSpace).toMatchObject(probed);
      expect(result.totalFrames).toBe(readdirSync(unfilteredDir).length);
      const last = result.framePaths.get(result.totalFrames - 1)!;
      const source = readFirstFramePixel(fixture, 10, 10);
      const shown = readFirstFramePixel(last, 10, 10);
      const worst = Math.max(...shown.map((v, i) => Math.abs(v - source[i]!)));
      expect(worst, `source ${source} ${format} ${shown}`).toBeLessThanOrEqual(
        format === "png" ? 0 : 3,
      );
      if (format === "png") expect(pngChunkTypes(last)).toContain("sRGB");
    },
    60_000,
  );

  it("leaves SDR-to-HDR frames in the HDR colours they were converted to", async () => {
    const outputDir = join(FIXTURE_DIR, "out-sdr-to-hdr-gate");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractVideoFramesRange(UI_FIXTURE, "sdr-to-hdr-gate", 0, 1, {
      fps: 1,
      outputDir,
      format: "png",
      sdrToHdrTransfer: "pq",
    });

    expect(pngChunkTypes(result.framePaths.get(0)!)).not.toContain("sRGB");
  }, 60_000);

  it("extracts each video at its own shown box, and caches halved frames apart from full ones", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-extract-shown-cache-"));
    const size = (path: string) =>
      spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        "--",
        path,
      ])
        .stdout.toString()
        .trim();
    const run = async (
      name: string,
      shownBoxes?: Map<string, { width: number; height: number }>,
    ) => {
      const outputDir = join(FIXTURE_DIR, name);
      mkdirSync(outputDir, { recursive: true });
      const result = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir, shownBoxes },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(result.errors).toEqual([]);
      return {
        size: size(result.extracted[0]!.framePaths.get(0)!),
        hits: result.phaseBreakdown.cacheHits,
      };
    };
    try {
      const half = new Map([
        ["ui", { width: UI_FIXTURE_WIDTH / 2, height: UI_FIXTURE_HEIGHT / 2 }],
      ]);
      expect(await run("shown-full")).toEqual({
        size: `${UI_FIXTURE_WIDTH},${UI_FIXTURE_HEIGHT}`,
        hits: 0,
      });
      expect(await run("shown-half", half)).toEqual({
        size: `${UI_FIXTURE_WIDTH / 2},${UI_FIXTURE_HEIGHT / 2}`,
        hits: 0,
      });
      expect(await run("shown-half-again", half)).toEqual({
        size: `${UI_FIXTURE_WIDTH / 2},${UI_FIXTURE_HEIGHT / 2}`,
        hits: 1,
      });
      expect(await run("shown-full-again")).toEqual({
        size: `${UI_FIXTURE_WIDTH},${UI_FIXTURE_HEIGHT}`,
        hits: 1,
      });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps jpg and png extraction caches separate", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-extract-format-cache-"));
    try {
      const defaultOut = join(FIXTURE_DIR, "cache-default");
      const pngOut = join(FIXTURE_DIR, "cache-png");
      const pngHitOut = join(FIXTURE_DIR, "cache-png-hit");
      mkdirSync(defaultOut, { recursive: true });
      mkdirSync(pngOut, { recursive: true });
      mkdirSync(pngHitOut, { recursive: true });

      const defaultResult = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir: defaultOut },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(defaultResult.errors).toEqual([]);
      expect(defaultResult.phaseBreakdown.cacheHits).toBe(0);
      expect(defaultResult.phaseBreakdown.cacheMisses).toBe(1);
      expect(defaultResult.extracted[0]!.framePaths.get(0)!.endsWith(".jpg")).toBe(true);

      const pngMiss = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir: pngOut, format: "png" },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(pngMiss.errors).toEqual([]);
      expect(pngMiss.phaseBreakdown.cacheHits).toBe(0);
      expect(pngMiss.phaseBreakdown.cacheMisses).toBe(1);
      expect(pngMiss.extracted[0]!.framePaths.get(0)!.endsWith(".png")).toBe(true);

      const pngHit = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir: pngHitOut, format: "png" },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(pngHit.errors).toEqual([]);
      expect(pngHit.phaseBreakdown.cacheHits).toBe(1);
      expect(pngHit.phaseBreakdown.cacheMisses).toBe(0);
      expect(pngHit.extracted[0]!.framePaths.get(0)!.endsWith(".png")).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("dedupes identical extractions within one render", async () => {
    const outputDir = join(FIXTURE_DIR, "out-dedupe");
    mkdirSync(outputDir, { recursive: true });

    const videoA: VideoElement = { ...fixtureVideo(), id: "dupe-a" };
    const videoB: VideoElement = { ...fixtureVideo(), id: "dupe-b" };

    const result = await extractAllVideoFrames([videoA, videoB], FIXTURE_DIR, {
      fps: 1,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(2);
    const first = result.extracted[0]!;
    const second = result.extracted[1]!;
    expect(first.videoId).toBe("dupe-a");
    expect(second.videoId).toBe("dupe-b");
    expect(second.outputDir).toBe(first.outputDir);
    expect(Array.from(second.framePaths.entries())).toEqual(Array.from(first.framePaths.entries()));

    const frameDirs = readdirSync(outputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(frameDirs).toEqual(["dupe-a"]);
    expect(readdirSync(first.outputDir).filter((f) => f.endsWith(".jpg"))).toHaveLength(
      first.totalFrames,
    );
  }, 60_000);
});

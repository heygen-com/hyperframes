import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertHeifToJpeg,
  HEIF_IMAGE_CONVERSION_FAILED,
  HeifImageConversionError,
  HeifToolUnavailableError,
  isHeifBytes,
  primaryGrid,
  prepareHeifImageInputs,
  type HeifTranscodeRequest,
} from "./heifImagePrep.js";

const FIXTURE = fileURLToPath(
  new URL("../../tests/fixtures/heic/rotated-grid.heic", import.meta.url),
);
// The fixture is a 1100x700 grid of six 512x512 tiles (3 across) tagged as a
// 270 degree counter-clockwise rotation, so it displays as 700x1100.
const SRC_W = 1100;
const SRC_H = 700;
const TILE = 512;

function ftyp(major: string, ...compatible: string[]): Buffer {
  const size = 16 + compatible.length * 4;
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(size, 0);
  buf.write("ftyp", 4, "ascii");
  buf.write(major, 8, "ascii");
  compatible.forEach((brand, i) => buf.write(brand, 16 + i * 4, "ascii"));
  return buf;
}

function rawFrame(args: string[]): Buffer {
  const run = spawnSync(
    "ffmpeg",
    ["-v", "error", ...args, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return run.stdout;
}

function px(frame: Buffer, width: number, x: number, y: number): number[] {
  const at = (y * width + x) * 3;
  return [frame[at]!, frame[at + 1]!, frame[at + 2]!];
}

/** Decodes the six tiles on their own and reads one pixel of the joined, unrotated image. */
function expectedUnrotated(tiles: Buffer[], xs: number, ys: number): number[] {
  const tile = tiles[Math.floor(ys / TILE) * 3 + Math.floor(xs / TILE)]!;
  return px(tile, TILE, xs % TILE, ys % TILE);
}

function expectClose(actual: number[], expected: number[], tolerance = 14): void {
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(actual[c]! - expected[c]!)).toBeLessThanOrEqual(tolerance);
  }
}

describe("prepareHeifImageInputs", () => {
  let root: string;
  let n = 0;
  const dirs = () => {
    const base = join(root, `case-${n++}`);
    return {
      projectDir: join(base, "project"),
      downloadDir: join(base, "downloads"),
      outputDir: join(base, "out"),
      base,
    };
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-heif-prep-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function project(files: Record<string, Buffer>) {
    const d = dirs();
    for (const [name, bytes] of Object.entries(files)) {
      const target = join(d.projectDir, name);
      spawnSync("mkdir", ["-p", join(target, "..")]);
      writeFileSync(target, bytes);
    }
    return d;
  }

  const countingTranscode = () => {
    const calls: HeifTranscodeRequest[] = [];
    return {
      calls,
      transcode: async (request: HeifTranscodeRequest) => {
        calls.push(request);
        await convertHeifToJpeg(request);
      },
    };
  };

  function expectUprightPhoto(jpegPath: string): void {
    const tiles = Array.from({ length: 6 }, (_, i) => rawFrame(["-i", FIXTURE, "-map", `0:${i}`]));
    const out = rawFrame(["-i", jpegPath]);
    // 90 degrees clockwise: output (x, y) shows source (y, SRC_H - 1 - x).
    const width = SRC_H;
    const height = SRC_W;
    expect(out.length).toBe(width * height * 3);
    for (const [x, y] of [
      [3, 3],
      [690, 3],
      [350, 550],
      [20, 1090],
      [690, 1090],
      [100, 520],
      [600, 520],
      [350, 1030],
    ] as const) {
      expectClose(px(out, width, x, y), expectedUnrotated(tiles, y, SRC_H - 1 - x));
    }
    // The tile seams (source columns 511|512 and 1023|1024) are continuous.
    for (const seam of [511, 1023]) {
      for (const x of [100, 350, 600]) {
        const a = px(out, width, x, seam);
        const b = px(out, width, x, seam + 1);
        expectClose(a, b, 6);
      }
    }
    // The white marker at the source top-left lands top-right when upright.
    expectClose(px(out, width, 690, 10), [255, 255, 255], 8);
  }

  it("joins and rotates a tiled HEIC from its pixels", async () => {
    const d = project({ "photo.heic": readFileSync(FIXTURE) });
    const result = await prepareHeifImageInputs('<img id="a" src="photo.heic">', d);
    const [prepared] = result.preparedImages;
    expect(result.html).toContain(prepared!.outputSrc);
    expect(result.html).not.toContain("photo.heic");
    expect(result.preparedAssets.get(prepared!.outputSrc)).toBe(prepared!.outputPath);
    expectUprightPhoto(prepared!.outputPath);
  });

  it("converts an inline data URL", async () => {
    const d = project({});
    const uri = `data:image/heic;base64,${readFileSync(FIXTURE).toString("base64")}`;
    const result = await prepareHeifImageInputs(`<img src="${uri}">`, d);
    expect(result.preparedImages).toHaveLength(1);
    expect(result.html).not.toContain("data:image/heic");
    expectUprightPhoto(result.preparedImages[0]!.outputPath);
  });

  it("converts a HEIC saved with a .jpg name", async () => {
    const d = project({ "photo.jpg": readFileSync(FIXTURE) });
    const result = await prepareHeifImageInputs('<img src="photo.jpg">', d);
    expect(result.preparedImages).toHaveLength(1);
    expectUprightPhoto(result.preparedImages[0]!.outputPath);
  });

  it("converts a downloaded source whose url and extension say otherwise", async () => {
    const d = project({ "downloaded-blob": readFileSync(FIXTURE) });
    const url = "https://cdn.example.com/photo.png?sig=1";
    const result = await prepareHeifImageInputs(`<img src="${url}">`, {
      ...d,
      sourceAssets: new Map([[url, join(d.projectDir, "downloaded-blob")]]),
    });
    expect(result.preparedImages).toHaveLength(1);
    expect(result.html).not.toContain("cdn.example.com");
  });

  it("converts identical content once, however many images use it", async () => {
    const bytes = readFileSync(FIXTURE);
    const d = project({ "a.heic": bytes, "b/copy.heic": bytes });
    const { calls, transcode } = countingTranscode();
    const result = await prepareHeifImageInputs(
      '<img src="a.heic"><img src="a.heic"><img src="b/copy.heic">',
      { ...d, transcode },
    );
    expect(calls).toHaveLength(1);
    expect(new Set(result.preparedImages.map((p) => p.outputSrc)).size).toBe(1);
    expect(result.html.match(/_heif_images\/hfheif-v1-/g) ?? []).toHaveLength(3);
  });

  it("names the file when a HEIC cannot be converted", async () => {
    const d = project({
      "shots/bad.heic": Buffer.concat([ftyp("heic", "mif1"), Buffer.alloc(64)]),
    });
    const error = await prepareHeifImageInputs('<img src="shots/bad.heic?v=2">', d).catch((e) => e);
    expect(error).toBeInstanceOf(HeifImageConversionError);
    expect(error.code).toBe(HEIF_IMAGE_CONVERSION_FAILED);
    expect(error.owner).toBe("user");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('"shots/bad.heic"');
    expect(error.message).not.toContain(d.projectDir);
    expect(error.message).toContain("JPEG or PNG");
  });

  it("blames the host, not the photo, when ffprobe is missing or too old", async () => {
    const d = project({ "a.heic": Buffer.concat([ftyp("heic", "mif1"), Buffer.alloc(64)]) });
    for (const said of [
      "[FFmpeg] ffprobe not found. Please install FFmpeg.",
      "[FFmpeg] ffprobe exit with code 1: Option not found",
    ]) {
      const transcode = async () => {
        throw new Error(said);
      };
      const error = await prepareHeifImageInputs('<img src="a.heic">', { ...d, transcode }).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(HeifToolUnavailableError);
      expect(error.owner).toBe("system");
      expect(error.message).toContain('"a.heic"');
      expect(error.message).toContain("7.0 or newer");
      expect(error.message).not.toContain("Re-export");
    }
  });

  it("leaves a failed image as authored and still converts the rest when told to report failures", async () => {
    const bad = Buffer.concat([ftyp("heic", "mif1"), Buffer.alloc(64)]);
    const d = project({ "bad.heic": bad, "good.heic": readFileSync(FIXTURE) });
    const failures: unknown[] = [];
    const result = await prepareHeifImageInputs('<img src="bad.heic"><img src="good.heic">', {
      ...d,
      onFailure: (error) => failures.push(error),
    });
    expect(failures).toHaveLength(1);
    expect(result.html).toContain('src="bad.heic"');
    expect(result.html).toContain("_heif_images/hfheif-v1-");
    expect(result.preparedImages).toHaveLength(1);
  });

  it("converts the primary item's grid, not an auxiliary grid listed first", () => {
    const grid = (width: number) => ({ components: [{ width, height: 10 }] });
    const probed = {
      stream_groups: [
        { ...grid(111), disposition: { default: 0 } },
        { ...grid(222), disposition: { default: 1 } },
      ],
    };
    expect(primaryGrid(probed)?.width).toBe(222);
    expect(primaryGrid({ stream_groups: [grid(5)] })?.width).toBe(5);
  });

  it("spawns nothing and writes nothing without a HEIC image", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    );
    const d = project({ "still.png": png, "clip.avif": ftyp("avif", "mif1", "miaf") });
    const { calls, transcode } = countingTranscode();
    for (const html of [
      '<div data-composition-id="x"></div>',
      '<img src="still.png"><img src="clip.avif"><img src="missing.png"><img src="https://x.test/a.png">',
    ]) {
      const result = await prepareHeifImageInputs(html, { ...d, transcode });
      expect(result.html).toBe(html);
      expect(result.preparedImages).toEqual([]);
    }
    expect(calls).toHaveLength(0);
    expect(existsSync(d.outputDir)).toBe(false);
  });

  it("reuses the cache across compiles", async () => {
    const d = project({ "photo.heic": readFileSync(FIXTURE) });
    const { calls, transcode } = countingTranscode();
    const opts = { ...d, transcode, cacheDir: join(d.base, "cache") };
    await prepareHeifImageInputs('<img src="photo.heic">', opts);
    await prepareHeifImageInputs('<img src="photo.heic">', {
      ...opts,
      outputDir: join(d.base, "out2"),
    });
    expect(calls).toHaveLength(1);
  });
});

describe("isHeifBytes", () => {
  it.each([
    ["heic", ["mif1"]],
    ["heix", []],
    ["hevc", []],
    ["hevx", []],
    ["heim", []],
    ["heis", []],
    ["mif1", ["heic"]],
    ["msf1", ["hevc"]],
    ["isom", ["heic"]],
  ])("accepts major %s with %p", (major, compatible) => {
    expect(isHeifBytes(ftyp(major, ...compatible))).toBe(true);
  });

  it.each([
    ["avif", ["mif1", "miaf"]],
    ["mif1", ["avif"]],
    ["avis", ["msf1"]],
    ["isom", ["mp42"]],
    ["qt  ", []],
  ])("rejects major %s with %p", (major, compatible) => {
    expect(isHeifBytes(ftyp(major, ...compatible))).toBe(false);
  });

  it("rejects non-ISO-BMFF bytes", () => {
    expect(isHeifBytes(Buffer.from("not a heic file at all"))).toBe(false);
  });
});

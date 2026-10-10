import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createContactSheet,
  createAssetContactSheet,
  createScrollContactSheet,
  createSvgContactSheet,
} from "./contactSheet.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-contact-sheet-test-"));
}

const QUADRANT_COLORS = [
  [240, 20, 20],
  [20, 240, 20],
  [20, 20, 240],
  [240, 240, 20],
];

async function quadrantJpeg(orientation: number): Promise<Buffer> {
  const width = 40;
  const height = 20;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = QUADRANT_COLORS[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)];
      if (color) data.set(color, (y * width + x) * 3);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .withMetadata({ orientation })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function expectQuadrants(
  path: string,
  cell: { x: number; y: number; width: number; height: number },
  order: readonly number[],
): Promise<void> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  for (const [index, colorIndex] of order.entries()) {
    const x = cell.x + Math.floor((cell.width * (index % 2 === 0 ? 1 : 3)) / 4);
    const y = cell.y + Math.floor((cell.height * (index < 2 ? 1 : 3)) / 4);
    const offset = (y * info.width + x) * info.channels;
    const expected = QUADRANT_COLORS[colorIndex];
    expect(expected).toBeDefined();
    if (!expected) throw new Error("Missing expected quadrant color");
    for (const [channel, value] of expected.entries()) {
      expect(Math.abs((data[offset + channel] ?? 0) - value)).toBeLessThanOrEqual(25);
    }
  }
}

describe("createContactSheet", () => {
  it.each([
    { orientation: 1, order: [0, 1, 2, 3], height: 20 },
    { orientation: 2, order: [1, 0, 3, 2], height: 20 },
    { orientation: 3, order: [3, 2, 1, 0], height: 20 },
    { orientation: 4, order: [2, 3, 0, 1], height: 20 },
    { orientation: 5, order: [0, 2, 1, 3], height: 80 },
    { orientation: 6, order: [2, 0, 3, 1], height: 80 },
    { orientation: 7, order: [3, 1, 2, 0], height: 80 },
    { orientation: 8, order: [1, 3, 0, 2], height: 80 },
  ])(
    "displays JPEG orientation $orientation in an upright cell",
    async ({ orientation, order, height }) => {
      const dir = tempDir();
      try {
        const input = join(dir, "portrait.jpg");
        const out = join(dir, "sheet.png");
        const original = await quadrantJpeg(orientation);
        writeFileSync(input, original);

        await createContactSheet([input], out, { cols: 1, cellWidth: 40 });

        await expect(sharp(out).metadata()).resolves.toMatchObject({
          width: 48,
          height: height + 34,
        });
        await expectQuadrants(out, { x: 4, y: 30, width: 40, height }, order);
        expect(readFileSync(input)).toEqual(original);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("orients every downloaded asset even when the first cell is unrotated", async () => {
    const dir = tempDir();
    try {
      const first = join(dir, "a.jpg");
      const second = join(dir, "b.jpg");
      writeFileSync(first, await quadrantJpeg(1));
      const original = await quadrantJpeg(6);
      writeFileSync(second, original);
      const out = join(dir, "contact-sheet.png");

      await expect(createAssetContactSheet(dir, out)).resolves.toEqual([out]);

      await expect(sharp(out).metadata()).resolves.toMatchObject({ width: 1940, height: 274 });
      await expectQuadrants(out, { x: 668, y: 30, width: 120, height: 240 }, [2, 0, 3, 1]);
      expect(readFileSync(second)).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes PNG output when the output path uses a .png extension", async () => {
    const dir = tempDir();
    try {
      const a = join(dir, "a.png");
      const b = join(dir, "b.png");
      const out = join(dir, "sheet.png");
      await sharp({
        create: {
          width: 16,
          height: 9,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toFile(a);
      await sharp({
        create: {
          width: 16,
          height: 9,
          channels: 3,
          background: { r: 0, g: 255, b: 0 },
        },
      })
        .png()
        .toFile(b);

      await createContactSheet([a, b], out, {
        cols: 2,
        cellWidth: 16,
        labelMode: "custom",
        labels: ["A", "B"],
        maxImages: 2,
      });

      // format alone would pass even if the SVG label overlay silently drew
      // nothing (e.g. Fontconfig misconfigured): the label band (default
      // padding=4, labelH=26 in contactSheet.ts) must contain pixels that
      // aren't the label background (#1a1a1a), not just an empty rect.
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      let nonBackgroundPixels = 0;
      for (let y = 4; y < 30; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * info.channels;
          if (data[i] !== 26 || data[i + 1] !== 26 || data[i + 2] !== 26) nonBackgroundPixels++;
        }
      }
      expect(nonBackgroundPixels).toBeGreaterThan(0);
      await expect(sharp(out).metadata()).resolves.toMatchObject({ format: "png" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.skipIf(process.platform === "win32")(
    "replaces a pre-planted symlink at the sheet path instead of writing through it",
    async () => {
      const dir = tempDir();
      try {
        const image = join(dir, "a.png");
        const victim = join(dir, "victim.txt");
        const out = join(dir, "contact-sheet.jpg");
        await sharp({
          create: { width: 16, height: 9, channels: 3, background: { r: 255, g: 0, b: 0 } },
        })
          .png()
          .toFile(image);
        writeFileSync(victim, "do not touch");
        symlinkSync(victim, out);

        await createContactSheet([image], out, { cellWidth: 16, maxImages: 1 });

        expect(readFileSync(victim, "utf8")).toBe("do not touch");
        await expect(sharp(out).metadata()).resolves.toMatchObject({ format: "jpeg" });
        expect(lstatSync(out).isSymbolicLink()).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe("contact-sheet capture budget", () => {
  it("does not start another Sharp page after the budget is exhausted", async () => {
    const dir = tempDir();
    try {
      for (let i = 0; i < 10; i++) {
        await sharp({
          create: {
            width: 4,
            height: 4,
            channels: 3,
            background: { r: i, g: i, b: i },
          },
        })
          .png()
          .toFile(join(dir, `scroll-${String(i).padStart(3, "0")}.png`));
      }

      let checks = 0;
      const output = join(dir, "contact-sheet.jpg");
      const sheets = await createScrollContactSheet(dir, output, {
        remainingMs: () => (checks++ === 0 ? 1000 : 0),
      });

      expect(sheets).toEqual([join(dir, "contact-sheet-1.jpg")]);
      expect(existsSync(join(dir, "contact-sheet-2.jpg"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("stops SVG thumbnail rasterization before the next native operation", async () => {
    const dir = tempDir();
    try {
      const svgs = join(dir, "svgs");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(svgs);
      writeFileSync(
        join(svgs, "a.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
      );
      writeFileSync(
        join(svgs, "b.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="2"/></svg>',
      );
      let checks = 0;

      const sheets = await createSvgContactSheet(
        svgs,
        join(dir, "svg-contact-sheet.jpg"),
        undefined,
        { remainingMs: () => (checks++ === 0 ? 1000 : 0) },
      );

      expect(sheets).toEqual([]);
      expect(checks).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

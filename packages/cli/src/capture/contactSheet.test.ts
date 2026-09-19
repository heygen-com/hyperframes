import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createContactSheet,
  createScrollContactSheet,
  createSvgContactSheet,
} from "./contactSheet.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-contact-sheet-test-"));
}

describe("createContactSheet", () => {
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

      // DIAGNOSTIC (temporary): first text render in a fresh process, with and without a Fontconfig file
      // present at process start (a mid-process env write may not reach the native library on Windows).
      const probe = `const sharp=require("sharp");const t=Date.now();sharp(Buffer.from('<svg width="64" height="26"><text x="8" y="18" font-family="Arial,sans-serif" font-size="13">A</text></svg>')).png().toBuffer().then(()=>console.log("child first text render ms",Date.now()-t));`;
      for (const [label, env] of [
        ["child without override", { ...process.env, FONTCONFIG_FILE: "" }],
        ["child with override at start", { ...process.env }],
      ] as const) {
        const out = spawnSync(process.execPath, ["-e", probe], {
          env,
          encoding: "utf8",
          cwd: process.cwd(),
        });
        console.log(label, out.stdout.trim(), out.stderr.trim().slice(0, 200));
      }
      // DIAGNOSTIC (temporary): which first-use step costs the ~4 s on Windows.
      const svg = (inner: string) => Buffer.from(`<svg width="64" height="26">${inner}</svg>`);
      console.time("first svg without text");
      await sharp(svg('<rect width="64" height="26" fill="#1a1a1a"/>')).png().toBuffer();
      console.timeEnd("first svg without text");
      console.time("first svg with text");
      await sharp(svg('<text x="8" y="18" font-family="Arial,sans-serif" font-size="13">A</text>'))
        .png()
        .toBuffer();
      console.timeEnd("first svg with text");
      console.time("createContactSheet");
      await createContactSheet([a, b], out, {
        cols: 2,
        cellWidth: 16,
        labelMode: "custom",
        labels: ["A", "B"],
        maxImages: 2,
      });
      console.timeEnd("createContactSheet");

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

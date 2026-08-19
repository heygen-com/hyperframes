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
  // Sharp on Windows CI runners exercises a native-binary fork per operation
  // and the runner's I/O throughput varies with concurrent-job pressure. The
  // default 20s ceiling has landed just-over the wall clock repeatedly (see
  // PR #2492's earlier lightweighting attempt); the actual work here — two
  // 16×9 PNG writes + one contact-sheet composite + one metadata probe —
  // is milliseconds of compute, so the extra ceiling only absorbs runner
  // I/O jitter, it does not hide a real slowdown.
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

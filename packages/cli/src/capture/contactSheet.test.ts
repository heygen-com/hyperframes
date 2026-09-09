import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createScrollContactSheet,
  createSvgContactSheet,
} from "./contactSheet.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-contact-sheet-test-"));
}

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

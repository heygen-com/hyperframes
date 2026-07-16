import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createContactSheet } from "./contactSheet.js";

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

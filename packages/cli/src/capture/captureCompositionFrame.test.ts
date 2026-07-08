import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFfmpegOnce } from "./captureCompositionFrame.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-capture-frame-test-"));
}

describe("runFfmpegOnce", () => {
  it("returns the process exit code and collected stderr", async () => {
    const dir = tempDir();
    try {
      const script = join(dir, "fail.cjs");
      writeFileSync(script, 'process.stderr.write("ffmpeg failed"); process.exit(3);\n');

      const result = await runFfmpegOnce(process.execPath, [script], 1000);

      expect(result).toEqual({ code: 3, stderr: "ffmpeg failed", timedOut: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("terminates the process when the timeout elapses", async () => {
    const dir = tempDir();
    try {
      const script = join(dir, "hang.cjs");
      writeFileSync(script, "setTimeout(() => {}, 10000);\n");

      const result = await runFfmpegOnce(process.execPath, [script], 50);

      expect(result.timedOut).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";

vi.mock(
  "node:path",
  async () => (await vi.importActual<typeof import("node:path")>("node:path")).win32,
);
vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  copyFileSync: vi.fn(),
}));

const { applyFaststart } = await import("./chunkEncoder.js");

describe("applyFaststart with Windows paths", () => {
  it.each([".mov", ".MOV", ".webm"])(
    "copies %s outputs using Windows extended-length paths",
    async (ext) => {
      vi.mocked(fs.copyFileSync).mockClear();
      const input = `C:\\Users\\alice\\AppData\\Local\\Temp\\hf-render-abc123\\video-only${ext}`;
      const output = `C:\\Users\\alice\\Documents\\${"deep-".repeat(35)}render${ext}`;

      const result = await applyFaststart(input, output);

      expect(result).toEqual({ success: true, outputPath: output, durationMs: 0 });
      expect(vi.mocked(fs.copyFileSync).mock.calls).toEqual([
        [`\\\\?\\${input}`, `\\\\?\\${output}`],
      ]);
    },
  );
});

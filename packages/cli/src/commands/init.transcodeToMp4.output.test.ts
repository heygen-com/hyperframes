import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted((): { script: string; child?: ChildProcess } => ({ script: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: (...args: Parameters<typeof original.spawn>) => {
      const child = original.spawn(process.execPath, [state.script, ...(args[1] ?? [])], args[2]);
      state.child = child;
      return child;
    },
  };
});
vi.mock("../browser/ffmpeg.js", () => ({
  findFFmpeg: () => process.execPath,
  findFFprobe: () => process.execPath,
  getFFmpegInstallHint: () => "install ffmpeg",
}));

import { transcodeToMp4 } from "./init.js";

describe("transcodeToMp4 output", () => {
  it.each(["stdout", "stderr"])("finishes after %s exceeds a pipe buffer", async (stream) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-transcode-output-test-"));
    const output = join(dir, "clip.mp4");
    state.script = join(dir, "encoder.cjs");
    writeFileSync(
      state.script,
      `process.${stream}.write(Buffer.alloc(2 * 1024 * 1024, 65), () => {
        require("node:fs").writeFileSync(process.argv.at(-1), "encoded video");
      });`,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = transcodeToMp4(join(dir, "input.mkv"), output);
      timer = setTimeout(() => state.child?.kill("SIGKILL"), 2000);
      expect(await result).toBe(true);
      expect(readFileSync(output, "utf8")).toBe("encoded video");
    } finally {
      clearTimeout(timer);
      state.child?.kill("SIGKILL");
      state.child = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reports an encoder failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-transcode-output-test-"));
    state.script = join(dir, "encoder.cjs");
    writeFileSync(state.script, "process.exitCode = 3;");
    try {
      expect(await transcodeToMp4(join(dir, "input.mkv"), join(dir, "clip.mp4"))).toBe(false);
    } finally {
      state.child?.kill("SIGKILL");
      state.child = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { EventEmitter } from "node:events";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const { spawnMock, processFrameMock, closeSessionMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  processFrameMock: vi.fn(async () => ({ fg: Buffer.alloc(4) })),
  closeSessionMock: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../browser/ffmpeg.js", () => ({
  findFFmpeg: () => "/fake/bin/ffmpeg",
  findFFprobe: () => "/fake/bin/ffprobe",
  getFFmpegInstallHint: () => "install ffmpeg",
}));
vi.mock("./inference.js", () => ({
  createSession: async () => ({
    provider: "test",
    process: processFrameMock,
    close: closeSessionMock,
  }),
}));
vi.mock("@hyperframes/engine", () => ({
  DEFAULT_VP9_CPU_USED: 4,
  renderProvenanceArgs: () => [],
  extractMediaMetadata: async () => ({ width: 1, height: 1, fps: 1, durationSeconds: 1 }),
}));

import { render } from "./pipeline.js";

function fakeFfmpeg(stdout: Readable, output?: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn(() => true), end: vi.fn() });
  proc.kill = vi.fn();
  if (output) writeFileSync(output, "rendered");
  queueMicrotask(() => proc.emit("exit", 0, null));
  return proc;
}

describe("background-removal FFmpeg child-process options", () => {
  it("hides every FFmpeg console window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    spawnMock
      .mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
      .mockImplementationOnce((_, args: string[]) => fakeFfmpeg(Readable.from([]), args.at(-1)));

    await render({ inputPath: "/tmp/input.mp4", outputPath: join(dir, "output.webm") });
    rmSync(dir, { recursive: true, force: true });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const call of spawnMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }
  });
});

describe("background-removal output", () => {
  it.skipIf(process.platform === "win32")(
    "lands at the output path even when a link is planted there mid-job, leaving its target alone",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
      const outside = join(dir, "outside.webm");
      const output = join(dir, "cutout.webm");
      writeFileSync(outside, "keep");
      spawnMock
        .mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
        .mockImplementationOnce((_, args: string[]) => {
          symlinkSync(outside, output);
          return fakeFfmpeg(Readable.from([]), args.at(-1));
        });
      try {
        await render({ inputPath: "/tmp/input.mp4", outputPath: output });
        expect(readFileSync(outside, "utf-8")).toBe("keep");
        expect(lstatSync(output).isSymbolicLink()).toBe(false);
        expect(readFileSync(output, "utf-8")).toBe("rendered");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

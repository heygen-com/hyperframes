import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, probeMock, processFrameMock, closeSessionMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  probeMock: vi.fn(),
  processFrameMock: vi.fn(async () => ({ fg: Buffer.alloc(24), bg: null })),
  closeSessionMock: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../browser/ffmpeg.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/ffmpeg.js")>()),
  findFFmpeg: () => "/fake/bin/ffmpeg",
  findFFprobe: () => "/fake/bin/ffprobe",
}));
vi.mock("../utils/cancellableProcess.js", () => ({ runCancellableProcess: probeMock }));
vi.mock("./inference.js", () => ({
  createSession: async () => ({
    provider: "test",
    process: processFrameMock,
    close: closeSessionMock,
  }),
}));
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  extractMediaMetadata: async () => ({ width: 3, height: 2, fps: 10, durationSeconds: 0.1 }),
}));

import { render } from "./pipeline.js";

function fakeFfmpeg(stdout: Readable, output?: string) {
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new EventEmitter(),
    stdin: new Writable({ write: (_chunk, _encoding, done) => done() }),
    kill: vi.fn(),
  });
  if (output) writeFileSync(output, "encoded frame");
  queueMicrotask(() => proc.emit("exit", 0, null));
  return proc;
}

describe("background-removal decoded orientation", () => {
  let dir: string;
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-background-orientation-"));
    vi.clearAllMocks();
    probeMock.mockResolvedValue({ stdout: JSON.stringify({ streams: [{}] }), stderr: "" });
    spawnMock
      .mockImplementationOnce(() => fakeFfmpeg(Readable.from([rgb])))
      .mockImplementationOnce((_, args: string[]) => fakeFfmpeg(Readable.from([]), args.at(-1)));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    { rotation: 90, width: 2, height: 3 },
    { rotation: -90, width: 2, height: 3 },
    { rotation: 270, width: 2, height: 3 },
    { rotation: -270, width: 2, height: 3 },
    { rotation: 0, width: 3, height: 2 },
    { rotation: 180, width: 3, height: 2 },
    { rotation: 45, width: 3, height: 2 },
  ])(
    "uses decoded dimensions for a $rotation° display matrix",
    async ({ rotation, width, height }) => {
      probeMock.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ side_data_list: [{ side_data_type: "Display Matrix", rotation }] }],
        }),
        stderr: "",
      });

      const result = await render({
        inputPath: join(dir, "phone.mp4"),
        outputPath: join(dir, "cutout.webm"),
      });

      expect(result.framesProcessed).toBe(1);
      expect(processFrameMock).toHaveBeenCalledWith(rgb, width, height, false);
      const encoderArgs = spawnMock.mock.calls[1]?.[1];
      expect(encoderArgs).toContain(`${width}x${height}`);
      expect(closeSessionMock).toHaveBeenCalledOnce();
    },
  );

  it.each(["90", "270"])("honors a legacy rotate=%s tag", async (rotate) => {
    probeMock.mockResolvedValue({
      stdout: JSON.stringify({ streams: [{ tags: { rotate } }] }),
      stderr: "",
    });

    await render({ inputPath: join(dir, "phone.mov"), outputPath: join(dir, "cutout.mov") });

    expect(processFrameMock).toHaveBeenCalledWith(rgb, 2, 3, false);
    expect(spawnMock.mock.calls[1]?.[1]).toContain("2x3");
  });

  it("gives the display matrix priority over a conflicting legacy tag", async () => {
    probeMock.mockResolvedValue({
      stdout: JSON.stringify({
        streams: [
          {
            tags: { rotate: "90" },
            side_data_list: [{ side_data_type: "Display Matrix", rotation: 0 }],
          },
        ],
      }),
      stderr: "",
    });

    await render({ inputPath: join(dir, "phone.mp4"), outputPath: join(dir, "cutout.webm") });

    expect(processFrameMock).toHaveBeenCalledWith(rgb, 3, 2, false);
  });

  it("preserves dimensions for a video without rotation metadata", async () => {
    await render({ inputPath: join(dir, "landscape.mp4"), outputPath: join(dir, "cutout.webm") });

    expect(processFrameMock).toHaveBeenCalledWith(rgb, 3, 2, false);
  });

  it("keeps the existing still-image path", async () => {
    await render({ inputPath: join(dir, "portrait.png"), outputPath: join(dir, "cutout.png") });

    expect(processFrameMock).toHaveBeenCalledWith(rgb, 3, 2, false);
    expect(probeMock).not.toHaveBeenCalled();
  });
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { extractAllVideoFrames } from "./videoFrameExtractor.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

let dir: string;
let server: Server;
let url = "";
const held: ServerResponse[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "hf-probe-cancel-"));
  // A source that never answers: each request is held open, unanswered.
  server = createServer((_req, res) => void held.push(res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/clip.mp4`;
});

afterAll(async () => {
  for (const res of held.splice(0)) res.destroy();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// fails without the fix: the source's metadata probe took no signal, so a cancel waited out ffprobe's deadline.
it.skipIf(!HAS_FFMPEG)(
  "a cancel during the probe of a source read at its URL stops frame extraction",
  async () => {
    const cancel = new AbortController();
    const video = { id: "v", src: "clip.mp4", start: 0, end: 1, mediaStart: 0, loop: false };
    const extraction = extractAllVideoFrames(
      [{ ...video, hasAudio: false }],
      dir,
      {
        fps: 30,
        outputDir: join(dir, "frames"),
        urlByAbsentLocalPath: new Map([[join(dir, "clip.mp4"), url]]),
      },
      cancel.signal,
    );
    extraction.catch(() => {});
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5_000 });
    cancel.abort(new Error("render cancelled"));

    await expect(extraction).rejects.toThrow();
  },
  10_000,
);

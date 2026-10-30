import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VideoElement } from "../types.js";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { declareContentAddressedUrl } from "../utils/ffprobe.js";
import { extractAllVideoFrames } from "./videoFrameExtractor.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!HAS_FFMPEG)("deferred windows of a remote source", { timeout: 120_000 }, () => {
  let dir: string;
  let server: Server;
  let open = 0;
  let peak = 0;
  let requests = 0;
  let url = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-remote-tail-"));
    const path = join(dir, "clip.mp4");
    const made = spawnSync(getFfmpegBinary(), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=8"],
      ...["-c:v", "libx264", "-g", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
    ]);
    expect(made.status).toBe(0);
    const body = readFileSync(path);
    server = createServer((req, res) => {
      const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
      open++;
      requests++;
      peak = Math.max(peak, open);
      res.on("close", () => open--);
      setTimeout(() => {
        res.writeHead(206, {
          "Accept-Ranges": "bytes",
          "Content-Length": body.length - start,
          "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
          "Content-Type": "video/mp4",
        });
        res.end(body.subarray(start));
      }, 300);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/content/clip.mp4`;
    declareContentAddressedUrl(url, "clip");
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  async function defer(mediaStart: (i: number) => number) {
    const videos: VideoElement[] = Array.from({ length: 24 }, (_, i) => ({
      id: `cut-${i}`,
      src: "clip.mp4",
      start: i * 3,
      end: i * 3 + 3,
      mediaStart: mediaStart(i),
      loop: false,
      hasAudio: false,
    }));
    peak = 0;
    requests = 0;
    const result = await extractAllVideoFrames(videos, dir, {
      fps: 30,
      outputDir: join(dir, `frames-${Math.random().toString(36).slice(2)}`),
      deferRangeExtraction: true,
      urlByAbsentLocalPath: new Map([[join(dir, "clip.mp4"), url]]),
    });
    expect(result.errors).toEqual([]);
    return result;
  }

  it("counts the frames of windows that end inside the source without decoding any", async () => {
    const result = await defer((i) => i * 0.1);

    expect(result.extracted.every((clip) => clip.deferredRange !== undefined)).toBe(true);
    expect(result.extracted.map((clip) => clip.totalFrames)).toEqual(Array(24).fill(90));
    expect(requests).toBeLessThanOrEqual(4);
  });

  it("decodes the tail of windows that reach the source end, many at a time", async () => {
    const result = await defer((i) => 5 + i * 0.05);

    expect(result.extracted.length).toBe(24);
    expect(peak).toBeGreaterThan(Math.max(1, Math.floor(cpus().length / 2)));
  });
});

describe.skipIf(!HAS_FFMPEG)(
  "a deferred window inside local sources of other shapes",
  { timeout: 120_000 },
  () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "hf-defer-shapes-"));
      const make = (name: string, args: string[]) => {
        const made = spawnSync(getFfmpegBinary(), ["-v", "error", "-y", ...args, join(dir, name)]);
        expect(made.status).toBe(0);
      };
      const source = ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30000/1001:duration=12"];
      make("ntsc-bframes.mp4", [...source, ...["-c:v", "libx264", "-bf", "3", "-g", "48"]]);
      make("vfr.mp4", [
        ...source,
        ...["-vf", "select=not(mod(n\\,3))+not(mod(n\\,7))", "-fps_mode", "vfr", "-c:v", "libx264"],
      ]);
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const window = (src: string, mediaStart: number): VideoElement => ({
      id: `w-${mediaStart}`,
      src,
      start: 0,
      end: 3,
      mediaStart,
      loop: false,
      hasAudio: false,
    });

    it.each([
      { fps: 24, mediaStart: 1.37 },
      { fps: 30, mediaStart: 0 },
      { fps: 60, mediaStart: 4.2 },
    ])(
      "counts $fps fps frames of an NTSC source with B-frames as extracting them does",
      async (c) => {
        const options = { fps: c.fps, outputDir: join(dir, `out-${c.fps}-${c.mediaStart}`) };
        const full = await extractAllVideoFrames(
          [window("ntsc-bframes.mp4", c.mediaStart)],
          dir,
          options,
        );
        const deferred = await extractAllVideoFrames(
          [window("ntsc-bframes.mp4", c.mediaStart)],
          dir,
          {
            ...options,
            outputDir: join(dir, `defer-${c.fps}-${c.mediaStart}`),
            deferRangeExtraction: true,
          },
        );

        expect(deferred.extracted[0]?.deferredRange).toBeDefined();
        expect(deferred.extracted[0]?.totalFrames).toBe(full.extracted[0]?.totalFrames);
      },
    );

    it("leaves a variable-frame-rate source to a full extraction", async () => {
      const deferred = await extractAllVideoFrames([window("vfr.mp4", 1)], dir, {
        fps: 30,
        outputDir: join(dir, "defer-vfr"),
        deferRangeExtraction: true,
      });

      expect(deferred.errors).toEqual([]);
      expect(deferred.extracted[0]?.deferredRange).toBeUndefined();
      expect(deferred.extracted[0]?.framePaths.size).toBeGreaterThan(0);
    });
  },
);

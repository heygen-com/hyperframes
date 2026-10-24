import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "./ffmpegBinaries.js";
import {
  declareContentAddressedUrl,
  extractAudioMetadata,
  extractMediaMetadata,
} from "./ffprobe.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!HAS_FFMPEG)("probing a file held at a URL", { timeout: 60_000 }, () => {
  let dir: string;
  let server: Server;
  let requests = 0;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-remote-identity-"));
    const path = join(dir, "take.mp4");
    const made = spawnSync(getFfmpegBinary(), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=25:duration=3"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-movflags", "+faststart", path],
    ]);
    expect(made.status).toBe(0);
    const body = readFileSync(path);
    server = createServer((req, res) => {
      requests++;
      const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
      res.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": body.length - start,
        "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
        "Content-Type": "video/mp4",
      });
      res.end(body.subarray(start));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const render = new AbortController().signal;

  async function probeFiveTimes(url: string, signal = render): Promise<number> {
    requests = 0;
    for (let i = 0; i < 5; i++) {
      await extractAudioMetadata(url, { signal });
      await extractMediaMetadata(url);
    }
    return requests;
  }

  it("reads a content-addressed URL once however many clips probe it", async () => {
    const url = `${base}/content/aaa.mp4?X-Amz-Signature=one`;
    declareContentAddressedUrl(url, "aaa");

    const once = await probeFiveTimes(url);
    const again = await probeFiveTimes(url);

    expect(once).toBeGreaterThan(0);
    expect(again).toBe(0);
  });

  it("probes a URL nobody declared every time, since its bytes can change", async () => {
    const signal = new AbortController().signal;
    const first = await probeFiveTimes(`${base}/mutable.mp4`, signal);
    const second = await probeFiveTimes(`${base}/mutable.mp4`, signal);

    expect(second).toBeGreaterThanOrEqual(first);
    expect(second).toBeGreaterThan(5);
  });
});

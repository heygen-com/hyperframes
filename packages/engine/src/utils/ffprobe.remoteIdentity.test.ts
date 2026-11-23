import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "./ffmpegBinaries.js";
import {
  buildProbeFactsText,
  declareContentAddressedUrl,
  declareProbeFactsUrl,
  readProbeJson,
  readStoredFinalFrame,
  extractAudioMetadata,
  extractFinalVideoFrameTimestamp,
  extractMediaMetadata,
} from "./ffprobe.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!HAS_FFMPEG)("probing a file held at a URL", { timeout: 60_000 }, () => {
  let dir: string;
  let server: Server;
  let requests = 0;
  let base: string;
  let factsJson = "";

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
    factsJson = await buildProbeFactsText(path);
    server = createServer((req, res) => {
      requests++;
      if (req.url?.startsWith("/facts/")) return void res.writeHead(200).end(factsJson);
      if (req.url?.startsWith("/facts-other-major/")) {
        const other = { ...JSON.parse(factsJson), ffprobeMajor: 99 };
        return void res.writeHead(200).end(JSON.stringify(other));
      }
      if (req.url?.startsWith("/gone/")) return void res.writeHead(404).end("gone");
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

  it("answers a declared URL's probe from its stored JSON without touching the media", async () => {
    const url = `${base}/gone/stored.mp4`;
    declareProbeFactsUrl(url, `${base}/facts/stored.json`);

    const metadata = await extractMediaMetadata(url);

    expect(metadata.width).toBe(64);
    expect(metadata.hasAudio).toBe(true);
  });

  it("answers a declared URL's final-frame timestamp from its stored copy, for the window it was stored for", async () => {
    const url = `${base}/gone/final.mp4`;
    declareProbeFactsUrl(url, `${base}/facts/final.json`);
    const metadata = await extractMediaMetadata(url);
    const window = {
      videoStreamStartSeconds: metadata.videoStreamStartSeconds,
      videoStreamDurationSeconds: metadata.videoStreamDurationSeconds,
    };

    const seconds = await extractFinalVideoFrameTimestamp(url, window);

    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThanOrEqual(3);
  });

  it("stores the final packet's duration beside the final frame, and reads it back", async () => {
    const url = `${base}/gone/packet.mp4`;
    declareProbeFactsUrl(url, `${base}/facts/packet.json`);
    const metadata = await extractMediaMetadata(url);

    const stored = await readStoredFinalFrame(url, metadata);

    expect(stored?.lastPacketSeconds).toBeCloseTo(0.04, 3);
  });

  it("ignores the stored final frame when another ffprobe major version stored it", async () => {
    const url = `${base}/gone/major.mp4`;
    declareProbeFactsUrl(url, `${base}/facts-other-major/major.json`);
    const metadata = await extractMediaMetadata(url);

    expect(await readStoredFinalFrame(url, metadata)).toBeUndefined();
  });

  it("records the ffprobe major version beside the facts, when the build reports one", () => {
    const binary = getFfprobeBinary();
    const banner = spawnSync(binary, ["-version"], { encoding: "utf-8" }).stdout;
    const major = Number(/version n?(\d+)/.exec(banner)?.[1]) || undefined;
    expect(JSON.parse(factsJson).ffprobeMajor).toBe(major);
  });

  it("probes the media itself when its stored JSON cannot be read", async () => {
    const url = `${base}/content/fallback.mp4`;
    declareProbeFactsUrl(url, `${base}/gone/facts.json`);

    expect(JSON.parse(await readProbeJson(url)).streams.length).toBe(2);
  });
});

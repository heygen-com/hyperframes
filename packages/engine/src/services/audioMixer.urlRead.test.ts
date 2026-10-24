import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { processCompositionAudio } from "./audioMixer.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const BYTES_PER_SECOND = 48_000 * 2 * 2;

// Writes the body in pieces, counting the bytes served.
async function streamBody(
  res: ServerResponse,
  body: Buffer,
  start: number,
  served?: { bytes: number },
): Promise<void> {
  for (let at = start; at < body.length && !res.destroyed; at += 65_536) {
    const piece = body.subarray(at, at + 65_536);
    if (served) served.bytes += piece.length;
    if (!res.write(piece)) await once(res, "drain").catch(() => undefined);
  }
  res.end();
}

// A range server like S3's (ffmpeg asks for `bytes=<start>-`). With `cut`, the first read starting
// at `cut.from` or later (past the probes' header reads) stops at `cut.at`, and every later request
// is refused, as for a link that just expired.
function serve(
  body: Buffer,
  cut?: { from: number; at: number },
  served?: { bytes: number },
): Promise<Server> {
  let refusing = false;
  const server = createServer(async (req, res) => {
    if (refusing) return void res.writeHead(403).end("Request has expired");
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
    res.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": body.length - start,
      "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
      "Content-Type": "audio/wav",
    });
    const cutHere = cut !== undefined && start >= cut.from && start < cut.at;
    if (!cutHere) return streamBody(res, body, start, served);
    refusing = true;
    res.write(body.subarray(start, cut.at), () => res.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Each case runs a mix of real ffmpeg processes, and on a Windows runner busy with the engine's 200-clip
// mixes they take seconds, not the default 5. The assertions hold at any speed, so the suite is not timed.
describe.skipIf(!HAS_FFMPEG)("audio cut from a cloud-held file's URL", { timeout: 60_000 }, () => {
  let dir: string;
  let server: Server | undefined;
  let abort: AbortController;
  let mixing: Promise<unknown> | undefined;

  function makeMedia(name: string, args: string[]): Buffer {
    const path = join(dir, name);
    const made = spawnSync(getFfmpegBinary(), ["-v", "error", "-y", ...args, path]);
    expect(made.status).toBe(0);
    return readFileSync(path);
  }

  const makeVoice = () =>
    makeMedia("voice.wav", [
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=20"],
      ...["-ac", "2", "-c:a", "pcm_s16le"],
    ]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-audio-url-read-"));
    abort = new AbortController();
    mixing = undefined;
  });

  afterEach(async () => {
    // A mix still running holds its work files open, and Windows refuses to delete an open file.
    abort.abort();
    await mixing?.catch(() => undefined);
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function mixFromUrl(
    clip: { name: string; type: "audio" | "video"; mediaStart: number; end: number } = {
      name: "voice.wav",
      type: "audio",
      mediaStart: 2,
      end: 10,
    },
  ) {
    const { port } = server!.address() as AddressInfo;
    const baseDir = join(dir, "project");
    mixing = processCompositionAudio(
      [
        {
          id: "clip",
          src: `takes/${clip.name}`,
          start: 0,
          end: clip.end,
          mediaStart: clip.mediaStart,
          layer: 0,
          volume: 1,
          type: clip.type,
        },
      ],
      baseDir,
      join(dir, "work"),
      join(dir, "out.m4a"),
      clip.end,
      abort.signal,
      {
        urlByAbsentLocalPath: new Map([
          [join(baseDir, "takes", clip.name), `http://127.0.0.1:${port}/${clip.name}`],
        ]),
      },
    );
    return mixing as ReturnType<typeof processCompositionAudio>;
  }

  it("mixes the whole span when the URL serves it", async () => {
    server = await serve(makeVoice());

    const result = await mixFromUrl();

    expect(result.failures).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("fails the track when the read is cut mid-span, instead of padding it with silence", async () => {
    // The clip reads source seconds 2 to 12; the link fails at second 6.
    server = await serve(makeVoice(), { from: BYTES_PER_SECOND, at: 6 * BYTES_PER_SECOND });

    const result = await mixFromUrl();

    expect(result.success).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        elementId: "clip",
        stage: "prepare",
        reason: "download_failed",
        owner: "system",
        retryable: true,
      }),
    ]);
  });

  it("mixes a video whose audio track ends before its picture", async () => {
    const video = makeMedia("take.mp4", [
      ...["-f", "lavfi", "-i", "testsrc2=size=64x64:rate=25:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-movflags", "+faststart"],
    ]);
    server = await serve(video);

    const result = await mixFromUrl({ name: "take.mp4", type: "video", mediaStart: 0, end: 6 });

    expect(result.failures).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("reads a video's audio sidecar and mixes exactly the audio the video itself gives", async () => {
    const take = makeMedia("take.mp4", [
      ...["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=100"],
      ...["-f", "lavfi", "-i", "anoisesrc=d=100:c=pink:r=48000:seed=7:amplitude=0.4"],
      ...["-c:v", "mpeg4", "-b:v", "3M", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"],
    ]);
    const sidecar = makeMedia("take.audio.m4a", [
      ...["-i", join(dir, "take.mp4"), "-map", "0:a:0", "-vn", "-c:a", "copy"],
      ...["-movflags", "+faststart", "-f", "mp4"],
    ]);
    const clip = {
      start: 0,
      end: 60,
      mediaStart: 20.37,
      layer: 0,
      volume: 1,
      type: "video" as const,
    };
    const mix = (
      urls: Map<string, string>,
      sidecars: Map<string, string> | undefined,
      name: string,
    ) =>
      processCompositionAudio(
        [{ id: "take-audio", src: "takes/take.mp4", ...clip }],
        join(dir, "project"),
        join(dir, `work-${name}`),
        join(dir, `${name}.m4a`),
        clip.end,
        abort.signal,
        {
          urlByAbsentLocalPath: urls,
          audioSidecarUrlByLocalPath: sidecars,
          keepEncoderInputAt: join(dir, `${name}.wav`),
        },
      );

    const local = join(dir, "project", "takes", "take.mp4");
    mkdirSync(join(dir, "project", "takes"), { recursive: true });
    writeFileSync(local, take);
    expect((await mix(new Map(), undefined, "local")).success).toBe(true);
    rmSync(local);

    const takeServed = { bytes: 0 };
    server = await serve(take, undefined, takeServed);
    const sidecarServer = await serve(sidecar);
    try {
      const takeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/take.mp4`;
      const sidecarUrl = `http://127.0.0.1:${(sidecarServer.address() as AddressInfo).port}/take.m4a`;
      const remote = await mix(
        new Map([[local, takeUrl]]),
        new Map([[local, sidecarUrl]]),
        "remote",
      );

      expect(remote.success).toBe(true);
      expect(
        readFileSync(join(dir, "remote.wav")).equals(readFileSync(join(dir, "local.wav"))),
      ).toBe(true);
      expect(takeServed.bytes).toBeLessThan(take.length / 4);
    } finally {
      await new Promise((resolve) => sidecarServer.close(resolve));
    }
  });

  it("reads many clips of one URL at once, since the wait is on the network and not the CPU", async () => {
    const body = makeVoice();
    let open = 0;
    let peak = 0;
    server = createServer((req, res) => {
      const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
      open++;
      peak = Math.max(peak, open);
      res.on("close", () => open--);
      setTimeout(() => {
        res.writeHead(206, {
          "Accept-Ranges": "bytes",
          "Content-Length": body.length - start,
          "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
        });
        res.end(body.subarray(start));
      }, 300);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const baseDir = join(dir, "project");
    const local = join(baseDir, "takes", "voice.wav");

    const result = await processCompositionAudio(
      Array.from({ length: 24 }, (_, i) => ({
        id: `clip-${i}`,
        src: "takes/voice.wav",
        start: i,
        end: i + 1,
        mediaStart: i % 10,
        layer: i,
        volume: 1,
        type: "audio" as const,
      })),
      baseDir,
      join(dir, "work"),
      join(dir, "out.m4a"),
      24,
      abort.signal,
      { urlByAbsentLocalPath: new Map([[local, `http://127.0.0.1:${port}/voice.wav`]]) },
    );

    expect(result.success).toBe(true);
    expect(peak).toBeGreaterThan(Math.max(2, Math.floor(cpus().length / 2)));
  });
});

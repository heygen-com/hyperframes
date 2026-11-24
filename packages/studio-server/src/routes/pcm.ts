import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import { requireFfBinary } from "@hyperframes/parsers/ff-binaries";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { probeAudioTrack } from "../helpers/mediaMetadata.js";
import { mediaInputArgs } from "../helpers/mediaExtensions.js";
import { inAudioDecodeSlot } from "../helpers/audioDecodes.js";
import { requestSubPath } from "../helpers/requestSubPath.js";

const RATES = new Set([48_000, 24_000]);

/** A project file's audio for analysis as float32 PCM, streamed, so no page decodes it whole: its first channel (what
 * the fx read), or with `channels=all` every channel interleaved (beat detection, which sums each one's power). */
export function registerPcmRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/pcm/*", async (c) => {
    const rate = Number(c.req.query("rate"));
    const all = c.req.query("channels") === "all";
    if (!RATES.has(rate)) return c.json({ error: "rate must be 48000 or 24000" }, 400);
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const audioPath = resolve(project.dir, requestSubPath(c.req.url, "projects/:id/pcm"));
    if (
      !isWithinProjectRoot(project.dir, audioPath) ||
      !(await stat(audioPath).catch(() => null))
    ) {
      return c.json({ error: "file not found" }, 404);
    }
    const track = await probeAudioTrack(audioPath);
    if (!track) return c.json({ error: "no audio stream" }, 422);
    const args = [...mediaInputArgs(audioPath), "-i", audioPath, "-map", `0:a:${track.stream}`];
    const out = [...(all ? [] : ["-af", "pan=mono|c0=c0"]), "-ar", String(rate), "-f", "f32le"];
    const proc = await new Promise<ChildProcess>((started, gone) => {
      inAudioDecodeSlot(() => {
        const ffmpeg = spawn(requireFfBinary("ffmpeg"), [...args, ...out, "-vn", "pipe:1"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          signal: c.req.raw.signal,
        });
        started(ffmpeg);
        return new Promise((ended) => ffmpeg.once("close", ended));
      }, c.req.raw.signal).catch(gone);
    }).catch(() => null);
    if (!proc?.stdout) return new Response(null, { status: 499 });
    // Ends only once ffmpeg has: a decode that fails partway errors the body, never a 200 cut short.
    const body = new PassThrough();
    proc.stdout.pipe(body, { end: false });
    proc.once("close", (code) =>
      code === 0 ? body.end() : body.destroy(new Error(`ffmpeg exited ${code}`)),
    );
    proc.once("error", (error) => body.destroy(error));
    return new Response(Readable.toWeb(body) as unknown as ReadableStream, {
      headers: {
        "content-type": "application/octet-stream",
        "x-sample-rate": String(rate),
        "x-channels": String(all ? track.channels : 1),
      },
    });
  });
}

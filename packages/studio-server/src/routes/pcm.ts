import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import { requireFfBinary } from "@hyperframes/parsers/ff-binaries";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { probeAudioTrack } from "../helpers/mediaMetadata.js";
import { mediaInputArgs } from "../helpers/mediaExtensions.js";
import { requestSubPath } from "../helpers/requestSubPath.js";

const RATES = new Set([48_000, 24_000]);

/** A project file's audio for analysis as float32 PCM, streamed, so no page decodes it whole: its first channel (what
 * the fx read), or with `mix=1` every channel mixed down (what beat detection reads). */
export function registerPcmRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/pcm/*", async (c) => {
    const rate = Number(c.req.query("rate"));
    const channels = c.req.query("mix") === "1" ? ["-ac", "1"] : ["-af", "pan=mono|c0=c0"];
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
    const proc = spawn(
      requireFfBinary("ffmpeg"),
      [...args, ...channels, "-ar", String(rate), "-f", "f32le", "-vn", "pipe:1"],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, signal: c.req.raw.signal },
    );
    proc.on("error", () => proc.stdout.destroy());
    return new Response(Readable.toWeb(proc.stdout) as unknown as ReadableStream, {
      headers: { "content-type": "application/octet-stream", "x-sample-rate": String(rate) },
    });
  });
}

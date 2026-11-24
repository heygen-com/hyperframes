import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "./ffmpegBinaries.js";
import { extractMediaMetadata, runFfprobe } from "./ffprobe.js";
import { runFfmpeg } from "./runFfmpeg.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

// A project file that is a playlist, concat list or manifest must not make the render host fetch the URLs inside it.
describe.skipIf(!HAS_FFMPEG)("local media files that list network URLs", () => {
  let server: Server;
  let dir: string;
  const hits: string[] = [];
  const files = new Map<string, string>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("x".repeat(1000));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dir = mkdtempSync(join(tmpdir(), "hf-nested-inputs-"));
    const hls = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${origin}/seg.ts\n#EXT-X-ENDLIST\n`;
    const concat = `ffconcat version 1.0\nfile '${origin}/part.mp4'\n`;
    const dash = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1S"><BaseURL>${origin}/</BaseURL><Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="1000"><SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="s1.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>`;
    for (const [name, text] of [
      ["clip.m3u8", hls],
      ["hls.mp4", hls],
      ["list.ffconcat", concat],
      ["concat.mp4", concat],
      ["clip.mpd", dash],
      ["dash.mp4", dash],
    ] as const) {
      files.set(name, join(dir, name));
      writeFileSync(join(dir, name), text);
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(["clip.m3u8", "hls.mp4", "list.ffconcat", "concat.mp4", "clip.mpd", "dash.mp4"])(
    "%s is probed and decoded without a request",
    async (name) => {
      const path = files.get(name)!;
      await runFfprobe(path, ["-show_format", "-show_streams"]).catch(() => undefined);
      await extractMediaMetadata(path).catch(() => undefined);
      await runFfmpeg(["-i", path, "-frames:v", "1", "-f", "null", "-"]);
      expect(hits).toEqual([]);
    },
  );
});

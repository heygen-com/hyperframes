import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setDownloadFetchForTests, getFfmpegBinary } from "@hyperframes/engine";
import { collectRenderMedia } from "../../renderMediaCollector.js";
import { appendVideoAudioFromProbe } from "./extractVideosStage.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)("appendVideoAudioFromProbe", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-video-audio-probe-"));
    mkdirSync(join(dir, "compiled"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _setDownloadFetchForTests();
    delete process.env.PRODUCER_RESTRICT_PAGE_NETWORK;
  });

  const make = (name: string, withAudio: boolean) => {
    const args = [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x64:rate=25:duration=4",
    ];
    if (withAudio)
      args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4");
    args.push("-c:v", "mpeg4", ...(withAudio ? ["-c:a", "aac"] : []), join(dir, name));
    expect(spawnSync(getFfmpegBinary(), args).status).toBe(0);
  };

  it("adds the sound of a video that has some, once per source, without extracting any frames", async () => {
    make("talk.mp4", true);
    make("silent.mp4", false);
    const composition =
      collectRenderMedia(`<div data-composition-id="root" data-start="0" data-duration="8">
      <video id="a" src="talk.mp4" data-start="0" data-duration="2" data-has-audio="true"></video>
      <video id="b" src="talk.mp4" data-start="2" data-duration="2" data-media-start="1" data-has-audio="true"></video>
      <video id="c" src="silent.mp4" data-start="4" data-duration="2" data-has-audio="true"></video>
    </div>`);
    composition.audios.length = 0;

    await appendVideoAudioFromProbe({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      composition,
    });

    expect(composition.audios.map((audio) => audio.id)).toEqual(["a-audio"]);
    expect(readdirSync(join(dir, "compiled"))).toEqual([]);
  });

  it("does not probe a remote source outside the public HTTPS policy", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const composition =
        collectRenderMedia(`<div data-composition-id="root" data-start="0" data-duration="2">
        <video id="r" src="http://127.0.0.1:${port}/clip.mp4" data-start="0" data-duration="2" data-has-audio="true"></video>
      </div>`);
      composition.audios.length = 0;

      await appendVideoAudioFromProbe({
        projectDir: dir,
        compiledDir: join(dir, "compiled"),
        composition,
      });

      expect(requests).toBe(0);
      expect(composition.audios).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it("on a render service probes a composition URL from a copy the downloader fetched", async () => {
    make("talk.mp4", true);
    const bytes = readFileSync(join(dir, "talk.mp4"));
    const fetched: string[] = [];
    _setDownloadFetchForTests(async (url) => {
      fetched.push(url);
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": String(bytes.length) },
      });
    });
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    const src = "https://media.probe.example/talk.mp4";
    const composition =
      collectRenderMedia(`<div data-composition-id="root" data-start="0" data-duration="2">
      <video id="r" src="${src}" data-start="0" data-duration="2" data-has-audio="true"></video>
    </div>`);
    composition.audios.length = 0;
    const downloadDir = join(dir, "audio-work");

    await appendVideoAudioFromProbe({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      composition,
      downloadDir,
    });

    expect(fetched).toEqual([src]);
    expect(readdirSync(downloadDir)).toHaveLength(1);
    expect(composition.audios.map((audio) => audio.id)).toEqual(["r-audio"]);
    expect(composition.audios[0]?.src).toBe(src);
  });

  it("on a render service skips a composition URL the downloader refuses", async () => {
    _setDownloadFetchForTests(async () => {
      throw Object.assign(new Error("host resolves to a non-public address"), {
        code: "HF_NON_PUBLIC_ADDRESS",
      });
    });
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    const composition =
      collectRenderMedia(`<div data-composition-id="root" data-start="0" data-duration="2">
      <video id="r" src="https://media.probe.example/clip.mp4" data-start="0" data-duration="2" data-has-audio="true"></video>
    </div>`);
    composition.audios.length = 0;

    await appendVideoAudioFromProbe({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      composition,
    });

    expect(composition.audios).toEqual([]);
  });
});

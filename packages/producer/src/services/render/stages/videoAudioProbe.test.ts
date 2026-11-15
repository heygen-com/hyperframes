import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setDownloadFetchForTests, getFfmpegBinary, resolveConfig } from "@hyperframes/engine";
import type { ProducerLogger } from "../../../logger.js";
import { createRenderJob } from "../../renderOrchestrator.js";
import { collectRenderMedia } from "../../renderMediaCollector.js";
import { appendVideoAudioFromProbe, runExtractVideosStage } from "./extractVideosStage.js";

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

  const remoteSrc = "https://media.probe.example/talk.mp4";
  const remoteComposition = (attrs = 'data-has-audio="true"') => {
    const composition =
      collectRenderMedia(`<div data-composition-id="root" data-start="0" data-duration="2">
      <video id="r" src="${remoteSrc}" data-start="0" data-duration="2" ${attrs}></video>
    </div>`);
    composition.audios.length = 0;
    return composition;
  };
  const serveTalk = (fetched: string[] = []) => {
    make("talk.mp4", true);
    const bytes = readFileSync(join(dir, "talk.mp4"));
    _setDownloadFetchForTests(async (url) => {
      fetched.push(url);
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": String(bytes.length) },
      });
    });
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    return fetched;
  };
  const failDownloads = (error: Error | Response) => {
    _setDownloadFetchForTests(async () => {
      if (error instanceof Response) return error;
      throw error;
    });
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
  };

  it("on a render service probes a composition URL from a copy the downloader fetched", async () => {
    const fetched = serveTalk();
    const composition = remoteComposition();
    const downloadDir = join(dir, "audio-work");

    await appendVideoAudioFromProbe({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      composition,
      downloadDir,
    });

    expect(fetched).toEqual([remoteSrc]);
    expect(readdirSync(downloadDir)).toHaveLength(1);
    expect(composition.audios.map((audio) => audio.id)).toEqual(["r-audio"]);
    expect(composition.audios[0]?.src).toBe(remoteSrc);
  });

  it("on a render service skips and logs a composition URL the address rules refuse", async () => {
    failDownloads(
      Object.assign(new Error("host resolves to a non-public address"), {
        code: "HF_NON_PUBLIC_ADDRESS",
      }),
    );
    const composition = remoteComposition();
    const warnings: unknown[][] = [];
    const log = { warn: (...args: unknown[]) => warnings.push(args) } as unknown as ProducerLogger;

    await appendVideoAudioFromProbe({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      composition,
      log,
    });

    expect(composition.audios).toEqual([]);
    expect(warnings).toEqual([[expect.stringContaining("skipped"), { videoId: "r" }]]);
  });

  it("on a render service fails on a download error that is not an address refusal", async () => {
    failDownloads(new Response("gone", { status: 404 }));

    await expect(
      appendVideoAudioFromProbe({
        projectDir: dir,
        compiledDir: join(dir, "compiled"),
        composition: remoteComposition(),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("on a render service a cancelled render stops the download", async () => {
    const fetched = serveTalk();
    const controller = new AbortController();
    controller.abort();

    await expect(
      appendVideoAudioFromProbe({
        projectDir: dir,
        compiledDir: join(dir, "compiled"),
        composition: remoteComposition(),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetched).toEqual([]);
  });

  it.each([
    ["has no sound", ""],
    ["is muted", 'data-has-audio="true" muted'],
    ["is hidden", 'data-has-audio="true"'],
  ])("on a render service downloads nothing for a video that %s", async (name, attrs) => {
    const fetched = serveTalk();
    const composition = remoteComposition(attrs);
    if (name === "is hidden") composition.videos[0]!.hidden = true;

    await appendVideoAudioFromProbe({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      composition,
    });

    expect(fetched).toEqual([]);
    expect(composition.audios).toEqual([]);
  });

  it("the extract stage downloads a passthrough video's URL into the audio work folder", async () => {
    const fetched = serveTalk();
    const composition = remoteComposition();
    const audioDownloadDir = join(dir, "audio-work");

    await runExtractVideosStage({
      projectDir: dir,
      compiledDir: join(dir, "compiled"),
      job: createRenderJob({ fps: { num: 30, den: 1 }, quality: "standard", hdrMode: "force-sdr" }),
      cfg: resolveConfig(),
      composition,
      skipFrameExtractionIds: ["r"],
      audioDownloadDir,
      abortSignal: undefined,
      assertNotAborted: () => {},
    });

    expect(fetched).toEqual([remoteSrc]);
    expect(readdirSync(audioDownloadDir)).toHaveLength(1);
    expect(composition.audios.map((audio) => audio.id)).toEqual(["r-audio"]);
  });
});

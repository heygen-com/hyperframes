import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFfmpegBinary } from "@hyperframes/engine";
import { collectRenderMedia } from "../../renderMediaCollector.js";
import { appendVideoAudioFromProbe } from "./extractVideosStage.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)("appendVideoAudioFromProbe", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-video-audio-probe-"));
    mkdirSync(join(dir, "compiled"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
});

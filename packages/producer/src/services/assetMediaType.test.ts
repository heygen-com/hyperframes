import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASSET_MEDIA_TYPE_MISMATCH,
  AssetMediaTypeMismatchError,
  preflightCompositionAssetMediaTypes,
} from "./assetMediaType.js";
import { synthesizeMediaFixture } from "./mediaTypeTestFixtures.js";

describe("preflightCompositionAssetMediaTypes", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hf-media-type-preflight-"));
  const projectDir = join(fixtureDir, "project");
  const compiledDir = join(fixtureDir, "compiled");
  const stillPath = join(projectDir, "extensionless-still");
  const videoPath = join(projectDir, "extensionless-video");
  const audioPath = join(projectDir, "extensionless-audio");
  const mixedPath = join(projectDir, "extensionless-mixed");

  beforeAll(() => {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(compiledDir, { recursive: true });
    synthesizeMediaFixture([
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=32x32:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-f",
      "image2",
      stillPath,
    ]);
    synthesizeMediaFixture([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x32:d=1:r=30",
      "-c:v",
      "mpeg4",
      "-f",
      "mp4",
      videoPath,
    ]);
    synthesizeMediaFixture([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      audioPath,
    ]);
    synthesizeMediaFixture([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x32:d=1:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=1",
      "-shortest",
      "-c:v",
      "mpeg4",
      "-c:a",
      "aac",
      "-f",
      "mp4",
      mixedPath,
    ]);
  }, 30_000);

  afterAll(() => {
    if (existsSync(fixtureDir)) rmSync(fixtureDir, { recursive: true, force: true });
  });

  function composition(input: { videoSrc?: string; audioSrc?: string; imageSrc?: string }) {
    return {
      videos: input.videoSrc
        ? [
            {
              id: "video-element",
              src: input.videoSrc,
              start: 0,
              end: 1,
              mediaStart: 0,
              loop: false,
              hasAudio: false,
            },
          ]
        : [],
      audios: input.audioSrc
        ? [
            {
              id: "audio-element",
              src: input.audioSrc,
              start: 0,
              end: 1,
              mediaStart: 0,
              layer: 0,
              type: "audio" as const,
            },
          ]
        : [],
      images: input.imageSrc
        ? [{ id: "image-element", src: input.imageSrc, start: 0, end: 1 }]
        : [],
    };
  }

  async function run(
    input: { videoSrc?: string; audioSrc?: string; imageSrc?: string },
    signal?: AbortSignal,
  ) {
    return preflightCompositionAssetMediaTypes({
      projectDir,
      compiledDir,
      composition: composition(input),
      signal,
    });
  }

  it("accepts valid extensionless image, video, and audio assets", async () => {
    await expect(
      run({
        imageSrc: "extensionless-still",
        videoSrc: "extensionless-video",
        audioSrc: "extensionless-audio",
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts a mixed audio/video container for an audio element", async () => {
    await expect(run({ audioSrc: "extensionless-mixed" })).resolves.toBeUndefined();
  });

  it.each([
    { name: "image under video", input: { videoSrc: "extensionless-still" }, detected: "image" },
    { name: "audio under video", input: { videoSrc: "extensionless-audio" }, detected: "audio" },
    { name: "video under image", input: { imageSrc: "extensionless-video" }, detected: "video" },
    { name: "audio under image", input: { imageSrc: "extensionless-audio" }, detected: "audio" },
    { name: "image under audio", input: { audioSrc: "extensionless-still" }, detected: "image" },
    {
      name: "silent video under audio",
      input: { audioSrc: "extensionless-video" },
      detected: "video",
    },
  ])("fails deterministically for $name", async ({ input, detected }) => {
    let caught: unknown;
    try {
      await run(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AssetMediaTypeMismatchError);
    expect(caught).toMatchObject({
      code: ASSET_MEDIA_TYPE_MISMATCH,
      owner: "user",
      retryable: false,
      mismatches: [expect.objectContaining({ detected })],
    });
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain(fixtureDir);
    expect(serialized).not.toContain("extensionless-");
    expect((caught as Error).message).not.toContain("video-element");
    expect((caught as Error).message).not.toContain("audio-element");
    expect((caught as Error).message).not.toContain("image-element");
  });

  it("catches the zero-video image-probe shape before extraction", async () => {
    const mismatched = composition({ imageSrc: "extensionless-audio" });
    expect(mismatched.videos).toHaveLength(0);
    await expect(
      preflightCompositionAssetMediaTypes({ projectDir, compiledDir, composition: mismatched }),
    ).rejects.toMatchObject({
      code: ASSET_MEDIA_TYPE_MISMATCH,
      owner: "user",
      retryable: false,
    });
  });

  it("does not relabel deterministic missing or corrupt media as a type mismatch", async () => {
    writeFileSync(join(projectDir, "corrupt-media"), "not a media container");
    await expect(run({ videoSrc: "missing-media" })).resolves.toBeUndefined();
    await expect(run({ imageSrc: "corrupt-media" })).resolves.toBeUndefined();
  });

  it("re-probes a path after its media contents are replaced", async () => {
    const mutablePath = join(projectDir, "mutable-media");
    const signal = new AbortController().signal;
    copyFileSync(audioPath, mutablePath);
    await expect(run({ videoSrc: "mutable-media" }, signal)).rejects.toMatchObject({
      code: ASSET_MEDIA_TYPE_MISMATCH,
      retryable: false,
    });

    copyFileSync(videoPath, mutablePath);
    await expect(run({ videoSrc: "mutable-media" }, signal)).resolves.toBeUndefined();
  });
});

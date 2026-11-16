import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NOT_MEDIA_PAYLOAD, NotMediaPayloadError } from "@hyperframes/engine";
import {
  ASSET_MEDIA_TYPE_MISMATCH,
  AssetMediaTypeMismatchError,
  dropMediaOutsideProject,
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

  // STUDIO-5433. This preflight sees every local media src regardless of its
  // authored timing, so it is the only place a document payload behind a
  // `data-end` video or a `loop`ing audio is caught before frames are captured
  // — for those elements the compiler never resolves a duration, so its own
  // sniff never runs.
  describe("non-media payloads", () => {
    beforeAll(() => {
      writeFileSync(
        join(projectDir, "streamed-preview.html"),
        "<!DOCTYPE html><html><body>not media</body></html>",
      );
      writeFileSync(
        join(projectDir, "brand-mark.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
      );
    });

    it("rejects an HTML payload under a video element", async () => {
      let caught: unknown;
      try {
        await run({ videoSrc: "streamed-preview.html" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NotMediaPayloadError);
      expect(caught).toMatchObject({
        code: NOT_MEDIA_PAYLOAD,
        owner: "user",
        retryable: false,
      });
      const message = (caught as Error).message;
      expect(message).not.toContain("streamed-preview.html");
      expect(message).not.toContain(fixtureDir);
    });

    it("reports the document verdict ahead of the type mismatch the same file also produces", async () => {
      // An HTML page under a <video> is both "not media" and "not video". The
      // document verdict is the actionable one; the mismatch is a symptom of it.
      await expect(run({ videoSrc: "streamed-preview.html" })).rejects.toBeInstanceOf(
        NotMediaPayloadError,
      );
    });

    it("leaves an audio source to the mixer's per-element classification", async () => {
      // A bad audio source is non-fatal by existing policy: the render ships
      // without the track and reports `audioError`. Aborting the whole compile
      // here would turn renders that used to succeed into hard failures, so
      // audioMixer classifies it as source/invalid_media/owner:user instead.
      await expect(run({ audioSrc: "streamed-preview.html" })).resolves.toBeUndefined();
    });

    it.each([{ audioSrc: "outside.m3u8" }, { imageSrc: "outside.m3u8" }])(
      "refuses a playlist naming a file outside its folder under any element: %o",
      async (input) => {
        writeFileSync(
          join(projectDir, "outside.m3u8"),
          "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n../../outside.mp4\n#EXT-X-ENDLIST\n",
        );
        await expect(run(input)).rejects.toBeInstanceOf(NotMediaPayloadError);
      },
    );

    it.each(["data:x/../streamed-preview.html", "BLOB:a/../streamed-preview.html"])(
      "sniffs a project file named behind a URL scheme: %s",
      async (videoSrc) => {
        await expect(run({ videoSrc })).rejects.toBeInstanceOf(NotMediaPayloadError);
      },
    );

    it("refuses a manifest as an image source", async () => {
      writeFileSync(
        join(projectDir, "manifest.png"),
        '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>',
      );
      await expect(run({ imageSrc: "manifest.png" })).rejects.toBeInstanceOf(NotMediaPayloadError);
    });

    it("leaves an SVG image source alone", async () => {
      // ffprobe reads SVG through its svg_pipe demuxer, so an XML body is a
      // legitimate <img> payload and must not be swept up by the sniff.
      await expect(run({ imageSrc: "brand-mark.svg" })).resolves.toBeUndefined();
    });
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

describe("dropMediaOutsideProject", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-media-outside-"));
  const projectDir = join(root, "project");
  const workDir = join(root, "work");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const keptVideos = (srcs: Record<string, string>, allowOutsideProjectAssets = false) => {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(root, "outside", "secret.txt"), "secret");
    const video = ([id, src]: [string, string]) => ({
      ...{ id, src, start: 0, end: 1, mediaStart: 0 },
      ...{ loop: false, hasAudio: false },
    });
    const composition = { videos: Object.entries(srcs).map(video), audios: [], images: [] };
    const log = { error() {}, info() {}, debug() {}, warn() {} };
    dropMediaOutsideProject({ projectDir, workDir, composition, log, allowOutsideProjectAssets });
    return composition.videos.map((v) => v.id);
  };

  it.each([false, true])(
    "drops media that names a private project file (outside assets allowed: %s)",
    (allowOutside) => {
      const srcs = {
        git: ".git/clip.mp4",
        app: ".hyperframes/clip.mp4",
        agent: ".claude/clip.mp4",
        ssh: "media/.ssh/clip.mp4",
        key: "media/id_rsa",
        link: "linked.mp4",
        local: "media/clip.mp4",
      };
      for (const src of Object.values(srcs).filter((src) => src !== "linked.mp4")) {
        mkdirSync(dirname(join(projectDir, src)), { recursive: true });
        writeFileSync(join(projectDir, src), "x");
      }
      rmSync(join(projectDir, "linked.mp4"), { force: true });
      symlinkSync(join(projectDir, ".git", "clip.mp4"), join(projectDir, "linked.mp4"));
      expect(keptVideos(srcs, allowOutside)).toEqual(["local"]);
    },
  );

  it("drops a URL scheme followed by parent folders, in any letter case", () => {
    const schemes = ["data:", "DATA:", "blob:", "Blob:", "about:", "https:", "HTTP:"];
    const srcs = Object.fromEntries(
      schemes.map((scheme, i) => [`v${i}`, `${scheme}x/../../outside/secret.txt`]),
    );
    expect(keptVideos(srcs)).toEqual([]);
  });

  it("keeps genuine inline, blob and remote media", () => {
    const srcs = {
      data: "data:video/mp4;base64,AAAAIGZ0eXBpc29t",
      long: `data:video/mp4;base64,${"A".repeat(5000)}/${"B".repeat(300)}`,
      blob: "blob:https://studio.example/0f6c9a52-6f1e-4d1e-9a51-2b1f3c4d5e6f",
      remote: "https://media.example.com/clip.mp4",
      local: "clip.mp4",
    };
    expect(keptVideos(srcs)).toEqual(Object.keys(srcs));
  });
});

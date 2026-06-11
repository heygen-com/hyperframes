import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import {
  buildAnimatedGifTranscodeArgs,
  prepareAnimatedGifInputs,
  type AnimatedGifTranscodeRequest,
} from "./animatedGifPrep.js";

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function ascii(value: string): number[] {
  return Array.from(value).map((char) => char.charCodeAt(0));
}

function frame(delayCentiseconds: number): number[] {
  return [
    0x21,
    0xf9,
    0x04,
    0x00,
    ...u16(delayCentiseconds),
    0x00,
    0x00,
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x02,
    0x02,
    0x4c,
    0x01,
    0x00,
  ];
}

function gif(frames: number[], loopCount?: number): Uint8Array {
  const loop =
    loopCount === undefined
      ? []
      : [0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 0x03, 0x01, ...u16(loopCount), 0x00];
  return Uint8Array.from([
    ...ascii("GIF89a"),
    ...u16(1),
    ...u16(1),
    0x00,
    0x00,
    0x00,
    ...loop,
    ...frames,
    0x3b,
  ]);
}

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "hf-gif-prep-"));
}

describe("buildAnimatedGifTranscodeArgs", () => {
  it("builds VP9 WebM args with alpha and finite-loop expansion", () => {
    const args = buildAnimatedGifTranscodeArgs({
      inputPath: "/in/reaction.gif",
      outputPath: "/out/reaction.webm",
      loopIterations: 3,
    });

    expect(args).toContain("-stream_loop");
    expect(args).toContain("2");
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("yuva420p");
    expect(args).toContain("-ignore_loop");
    // Output goes to an extension-less tmp path; the muxer must be explicit.
    expect(args.join(" ")).toContain("-f webm");
  });

  it("clone-pads the tail when the clip window outlives the looped source", () => {
    const args = buildAnimatedGifTranscodeArgs({
      inputPath: "/in/reaction.gif",
      outputPath: "/out/reaction.webm",
      loopIterations: 2,
      padSeconds: 1.5,
    });

    expect(args.join(" ")).toContain("tpad=stop_mode=clone:stop_duration=1.5");
  });
});

describe("prepareAnimatedGifInputs", () => {
  it("rewrites animated GIF images to muted looped videos", async () => {
    const projectDir = makeProject();
    writeFileSync(join(projectDir, "sticker.gif"), gif([...frame(5), ...frame(15)], 0));
    const calls: AnimatedGifTranscodeRequest[] = [];

    const result = await prepareAnimatedGifInputs(
      `<img class="clip badge" data-start="1" data-duration="4" src="sticker.gif" alt="sticker" />`,
      {
        projectDir,
        downloadDir: projectDir,
        transcode: async (request) => {
          calls.push(request);
          writeFileSync(request.outputPath, "webm");
        },
      },
    );

    const { document } = parseHTML(result.html);
    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toMatch(/^_animated_gif\/hfgif-v1-/);
    expect(video?.getAttribute("class")).toBe("clip badge");
    expect(video?.hasAttribute("loop")).toBe(true);
    expect(video?.hasAttribute("muted")).toBe(true);
    expect(video?.getAttribute("data-has-audio")).toBe("false");
    expect(video?.getAttribute("data-end")).toBe("5");
    expect(document.querySelector("img")).toBeNull();
    expect(result.preparedAssets.size).toBe(1);
    expect(result.preparedGifs[0]?.metadata.delaysCentiseconds).toEqual([5, 15]);
    expect(calls).toHaveLength(1);
    // 0.2s source looped to cover the 4s clip window: 20 iterations baked in,
    // because the render pipeline seek-syncs videos and ignores native loop.
    expect(result.preparedGifs[0]?.loopIterations).toBe(20);
    expect(calls[0]?.args.join(" ")).toContain("-stream_loop 19");
  });

  it("leaves single-frame GIF images unchanged", async () => {
    const projectDir = makeProject();
    writeFileSync(join(projectDir, "still.gif"), gif(frame(10)));
    const result = await prepareAnimatedGifInputs(`<img src="still.gif" />`, {
      projectDir,
      downloadDir: projectDir,
      transcode: async () => {
        throw new Error("should not transcode");
      },
    });

    expect(result.html).toContain("<img");
    expect(result.preparedAssets.size).toBe(0);
  });

  it("lets data-loop override infinite GIF metadata", async () => {
    const projectDir = makeProject();
    writeFileSync(join(projectDir, "reaction.gif"), gif([...frame(10), ...frame(10)], 0));
    const result = await prepareAnimatedGifInputs(
      `<img data-start="0" data-duration="2" data-loop="false" src="reaction.gif" />`,
      {
        projectDir,
        downloadDir: projectDir,
        transcode: async (request) => {
          writeFileSync(request.outputPath, "webm");
        },
      },
    );

    const { document } = parseHTML(result.html);
    expect(document.querySelector("video")?.hasAttribute("loop")).toBe(false);
  });

  it("expands finite loop metadata into the transcoded source", async () => {
    const projectDir = makeProject();
    writeFileSync(join(projectDir, "finite.gif"), gif([...frame(10), ...frame(10)], 3));
    const calls: AnimatedGifTranscodeRequest[] = [];

    const result = await prepareAnimatedGifInputs(`<img src="finite.gif" />`, {
      projectDir,
      downloadDir: projectDir,
      transcode: async (request) => {
        calls.push(request);
        writeFileSync(request.outputPath, "webm");
      },
    });

    expect(result.preparedGifs[0]?.loop).toBe(false);
    expect(result.preparedGifs[0]?.loopIterations).toBe(3);
    expect(calls[0]?.args).toContain("-stream_loop");
    expect(calls[0]?.args).toContain("2");
  });

  it("uses source asset mappings for remote GIF URLs", async () => {
    const projectDir = makeProject();
    const sourceUrl = "https://cdn.example.com/reaction.gif";
    const sourcePath = join(projectDir, "downloaded.gif");
    writeFileSync(sourcePath, gif([...frame(10), ...frame(10)], 0));

    const result = await prepareAnimatedGifInputs(
      `<img data-start="0" data-duration="2" src="${sourceUrl}" />`,
      {
        projectDir,
        downloadDir: projectDir,
        sourceAssets: new Map([[sourceUrl, sourcePath]]),
        transcode: async (request) => {
          writeFileSync(request.outputPath, "webm");
        },
      },
    );

    const { document } = parseHTML(result.html);
    expect(document.querySelector("video")?.getAttribute("src")).toMatch(
      /^_animated_gif\/hfgif-v1-/,
    );
    expect(result.preparedGifs[0]?.sourceSrc).toBe(sourceUrl);
  });
});

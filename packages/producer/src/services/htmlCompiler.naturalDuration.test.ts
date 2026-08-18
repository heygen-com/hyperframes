import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { compileForRender } from "./htmlCompiler.js";

describe("compileForRender natural media duration parity", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-natural-duration-"));
  const sourcePath = join(projectDir, "ten-seconds.mp4");
  const audioPath = join(projectDir, "ten-seconds.wav");

  beforeAll(() => {
    const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
    const generate = (args: string[]) => {
      const generated = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], {
        encoding: "utf8",
      });
      if (generated.status !== 0) throw new Error(generated.stderr || "failed to create fixture");
    };
    generate([
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=16x16:r=1:d=10",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      sourcePath,
    ]);
    generate([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=10",
      "-c:a",
      "pcm_s16le",
      "-y",
      audioPath,
    ]);
  });

  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  async function compile(media: string) {
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-duration="100" data-width="16" data-height="16">${media}</main></body></html>`,
    );
    const result = await compileForRender(projectDir, htmlPath, projectDir, {
      allowSystemFontCapture: false,
    });
    return { result, document: parseHTML(result.html).document };
  }

  it("uses shared playback-rate parsing for duration-less video and audio", async () => {
    const cases = [
      ["video-rate-2", "video", 'data-playback-rate="2"', 5],
      ["video-rate-2x", "video", 'data-playback-rate="2x"', 5],
      ["video-rate-0x2", "video", 'data-playback-rate="0x2"', 10],
      ["audio-rate-2x", "audio", 'data-playback-rate="2x"', 5],
    ] as const;
    const tags = cases
      .map(
        ([id, tag, attrs]) =>
          `<${tag} id="${id}" src="${tag === "audio" ? "ten-seconds.wav" : "ten-seconds.mp4"}" data-start="0" ${attrs}></${tag}>`,
      )
      .join("");
    const { document } = await compile(tags);

    for (const [id, , , expected] of cases) {
      const element = document.getElementById(id)!;
      expect(Number(element.getAttribute("data-duration"))).toBeCloseTo(expected, 3);
      expect(Number(element.getAttribute("data-end"))).toBeCloseTo(expected, 3);
    }
  });

  it("uses shared playback-start precedence and fallback semantics", async () => {
    const cases = [
      ["precedence", 'data-playback-start="2" data-media-start="7"', 8],
      ["empty", 'data-playback-start="" data-media-start="7"', 3],
      ["invalid", 'data-playback-start="later" data-media-start="7"', 3],
      ["negative-playback", 'data-playback-start="-1" data-media-start="7"', 3],
      ["negative-media", 'data-media-start="-1"', 10],
    ] as const;
    const tags = cases
      .map(
        ([id, attrs]) => `<video id="${id}" src="ten-seconds.mp4" data-start="0" ${attrs}></video>`,
      )
      .join("");
    const { document } = await compile(tags);

    for (const [id, , expected] of cases) {
      const element = document.getElementById(id)!;
      expect(Number(element.getAttribute("data-duration"))).toBeCloseTo(expected, 3);
      expect(Number(element.getAttribute("data-end"))).toBeCloseTo(expected, 3);
    }
  });

  it("injects a known zero span at and past EOF so video and audio are inactive", async () => {
    const { result, document } = await compile(`
      <video id="video-eof" src="ten-seconds.mp4" data-start="4" data-media-start="10" muted></video>
      <video id="video-past" src="ten-seconds.mp4" data-start="5" data-media-start="11" muted></video>
      <audio id="audio-eof" src="ten-seconds.wav" data-start="6" data-media-start="10"></audio>
      <audio id="audio-past" src="ten-seconds.wav" data-start="7" data-media-start="11"></audio>`);

    for (const [id, start] of [
      ["video-eof", 4],
      ["video-past", 5],
      ["audio-eof", 6],
      ["audio-past", 7],
    ] as const) {
      const element = document.getElementById(id)!;
      expect(element.getAttribute("data-duration")).toBe("0");
      expect(element.getAttribute("data-end")).toBe(String(start));
    }
    expect(result.videos).toEqual([]);
    expect(result.audios).toEqual([]);
  });

  it("keeps explicit data-duration authoritative", async () => {
    const { document } = await compile(
      '<video id="explicit" src="ten-seconds.mp4" data-start="2" data-duration="7" data-playback-rate="2"></video>',
    );
    const element = document.getElementById("explicit")!;
    expect(element.getAttribute("data-duration")).toBe("7");
    expect(element.getAttribute("data-end")).toBe("9");
  });
});

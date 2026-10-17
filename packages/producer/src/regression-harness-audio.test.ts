import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getFfmpegBinary } from "@hyperframes/engine";
import { compileForRender } from "./services/htmlCompiler.js";
import { runTestSuite } from "./regression-harness.js";

function ffmpeg(args: string[]): void {
  execFileSync(getFfmpegBinary(), ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: 30_000,
  });
}

describe("regression audio stream presence", () => {
  it.each([
    { renderedAudio: false, snapshotAudio: true, passed: false },
    { renderedAudio: true, snapshotAudio: false, passed: false },
    { renderedAudio: false, snapshotAudio: false, passed: true },
    { renderedAudio: true, snapshotAudio: true, passed: true },
  ])(
    "rendered audio $renderedAudio, snapshot audio $snapshotAudio: passes $passed",
    async ({ renderedAudio, snapshotAudio, passed }) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-regression-audio-"));
      try {
        const srcDir = join(dir, "src");
        const outputDir = join(dir, "output");
        mkdirSync(srcDir);
        mkdirSync(outputDir);
        const html = `<!doctype html><html><head><style>html,body{margin:0;width:160px;height:120px;background:#000}#root{position:absolute;inset:0;background:#000}</style></head><body><div id="root" data-composition-id="audio-presence" data-no-timeline data-width="160" data-height="120" data-start="0" data-duration="1">${renderedAudio ? '<audio id="audio" class="clip" src="silence.wav" data-start="0" data-duration="1" data-track-index="0"></audio>' : ""}</div></body></html>`;
        const inputPath = join(srcDir, "index.html");
        writeFileSync(inputPath, html);
        if (renderedAudio) {
          ffmpeg([
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-t",
            "1",
            join(srcDir, "silence.wav"),
          ]);
        }
        const compiled = await compileForRender(srcDir, inputPath, join(dir, "downloads"));
        writeFileSync(join(outputDir, "compiled.html"), compiled.html);
        ffmpeg([
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=160x120:r=10:d=1",
          ...(snapshotAudio ? ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"] : []),
          "-map",
          "0:v:0",
          ...(snapshotAudio ? ["-map", "1:a:0"] : []),
          "-t",
          "1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          ...(snapshotAudio ? ["-c:a", "aac"] : []),
          join(outputDir, "output.mp4"),
        ]);

        const result = await runTestSuite(
          {
            id: "audio-presence",
            dir,
            srcDir,
            meta: {
              name: "Audio presence",
              description: "Audio streams must exist on both sides or neither",
              tags: [],
              minPsnr: 30,
              maxFrameFailures: 0,
              minAudioCorrelation: 0,
              maxAudioLagWindows: 1,
              renderConfig: { fps: { num: 10, den: 1 }, workers: 1, captureMode: "screenshot" },
            },
          },
          { update: false, keepTemp: false, mode: "in-process" },
        );

        expect(result.compilation?.passed).toBe(true);
        expect(result.visual?.passed).toBe(true);
        expect(result.audio?.passed).toBe(passed);
        expect(result.passed).toBe(passed);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

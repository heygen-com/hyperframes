/**
 * Stages the converter's expected output for the hand-written fixtures in the import-timeline skill
 * against real media, then lints the project. This is the path a user takes after `otio_flatten.py`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { probeVideo } from "./init.js";
import { stageTimeline } from "./initTimeline.js";

const ffmpeg = findFFmpeg();
const available = ffmpeg !== undefined && findFFprobe() !== undefined;
const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/import-timeline/scripts/tests/fixtures",
);

let media: string;
let work: string;

function make(args: string[]): void {
  execFileSync(ffmpeg ?? "ffmpeg", ["-v", "error", "-y", ...args]);
}

beforeAll(() => {
  if (!available) return;
  work = mkdtempSync(join(tmpdir(), "hf-timeline-fixtures-"));
  media = join(work, "media");
  mkdirSync(join(media, "frames"), { recursive: true });
  const video = (name: string, source: string) =>
    make([
      "-f",
      "lavfi",
      "-i",
      `${source}=size=640x360:rate=24:duration=6`,
      "-pix_fmt",
      "yuv420p",
      join(media, name),
    ]);
  video("a.mp4", "testsrc");
  video("b.mp4", "smptebars");
  make(["-f", "lavfi", "-i", "sine=frequency=440:duration=8", join(media, "m.wav")]);
  make([
    "-f",
    "lavfi",
    "-i",
    "color=c=red:size=640x360:rate=24",
    "-frames:v",
    "12",
    join(media, "frames", "f.%03d.png"),
  ]);
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe.skipIf(!available)("fixtures stage into lint-clean projects", () => {
  for (const [name, clips] of [
    ["cut.expected.json", 5],
    ["cut-edl.expected.json", 2],
  ] as const) {
    it(`${name}: stages ${clips} clips and passes lint`, async () => {
      const destDir = join(work, `dest-${name}`);
      mkdirSync(destDir);
      const staged = stageTimeline({
        timelineFile: join(FIXTURES, name),
        destDir,
        mediaRoot: work,
        probeMedia: probeVideo,
      });
      expect(staged.clipCount).toBe(clips);
      expect(staged.warnings).toEqual([]);
      expect(existsSync(join(destDir, "assets", "a.mp4"))).toBe(true);
      const lint = await lintHyperframeHtml(staged.html);
      expect(lint.ok).toBe(true);
    });
  }

  it("the OTIO fixture's dissolve becomes a fade on the incoming clip, inside the film", () => {
    const destDir = join(work, "dest-dissolve");
    mkdirSync(destDir);
    const { html } = stageTimeline({
      timelineFile: join(FIXTURES, "cut.expected.json"),
      destDir,
      mediaRoot: work,
      probeMedia: probeVideo,
    });
    const fades = [
      ...html.matchAll(
        /tl\.fromTo\("#[^"]+", \{ opacity: 0 \}, \{ opacity: 1, duration: ([\d.]+)[^)]*, ([-\d.]+)\);/g,
      ),
    ];
    expect(fades).toHaveLength(1);
    expect(Number(fades[0]?.[2])).toBeGreaterThanOrEqual(0);
  });
});

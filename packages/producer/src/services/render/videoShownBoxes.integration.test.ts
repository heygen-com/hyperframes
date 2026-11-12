import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GSAP_CDN } from "@hyperframes/core";
import { resolveHeadlessShellPath } from "@hyperframes/engine";
import type { ProducerLogger } from "../../logger.js";
import { createRenderJob, executeRenderJob, resolveRenderDebugDir } from "../renderOrchestrator.js";

const chromePath = resolveHeadlessShellPath();
const CAN_RUN =
  chromePath !== undefined &&
  spawnSync(chromePath, ["--version"]).status === 0 &&
  spawnSync("ffmpeg", ["-version"]).status === 0;

// A 64x36 film with two 128x72 clips: `still` fills it (4K in 1080p, scaled down); `zoom` grows from 16x9 to 40x22.5.
const FILM = `<!doctype html>
<html><head><meta charset="utf-8"><script src="${GSAP_CDN}"></script></head>
<body style="margin:0;background:#000">
  <div id="root" data-composition-id="root" data-width="64" data-height="36" data-start="0" data-duration="0.5">
    <video id="still" src="clip.mp4" muted data-start="0" data-duration="0.5" style="position:absolute;left:0;top:0;width:64px;height:36px"></video>
    <video id="zoom" src="clip.mp4" muted data-start="0" data-duration="0.5" style="position:absolute;left:0;top:0;width:16px;height:9px"></video>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#zoom", { width: 40, height: 22.5, duration: 0.4, ease: "none" }, 0);
    tl.set({}, {}, 0.5);
    window.__timelines["root"] = tl;
  </script>
</body></html>`;

let root: string;
const savedRendersDir = process.env.PRODUCER_RENDERS_DIR;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hf-shown-box-"));
  process.env.PRODUCER_RENDERS_DIR = join(root, "renders");
});
afterAll(() => {
  if (savedRendersDir === undefined) delete process.env.PRODUCER_RENDERS_DIR;
  else process.env.PRODUCER_RENDERS_DIR = savedRendersDir;
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!CAN_RUN)("a local render extracts each video at the size it is shown", () => {
  it("halves a static clip onto its box and keeps a zooming clip's frames over its peak", async () => {
    const project = join(root, "film");
    mkdirSync(project, { recursive: true });
    const synth = spawnSync("ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=30:d=1"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", join(project, "clip.mp4")],
    ]);
    if (synth.status !== 0) throw new Error(synth.stderr.toString());
    writeFileSync(join(project, "index.html"), FILM);
    let measured: unknown;
    const quiet = () => {};
    const logger: ProducerLogger = {
      error: quiet,
      warn: quiet,
      debug: quiet,
      info: (message, meta) => {
        if (message.includes("boxes videos are shown at")) measured = meta;
      },
    };
    const job = createRenderJob({ fps: 30, quality: "draft", debug: true, logger });
    await executeRenderJob(job, project, join(root, "film.mp4"));

    const framesRoot = join(
      resolveRenderDebugDir(),
      job.id,
      "compiled",
      "__hyperframes_video_frames",
    );
    const frameSize = (id: string): string => {
      const dir = join(framesRoot, readdirSync(framesRoot).find((entry) => entry.includes(id))!);
      const first = join(dir, readdirSync(dir).find((file) => file.startsWith("frame_"))!);
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        "--",
        first,
      ]);
      return probe.stdout.toString().trim();
    };
    expect(measured).toMatchObject({ videos: 2, boxed: 2, seeks: 3 });
    expect(frameSize("still")).toBe("64,36");
    // Sized from its first frame (16x9) it would be halved twice to 32x18, under its 40x23 peak.
    expect(frameSize("zoom")).toBe("64,36");
  }, 90_000);
});

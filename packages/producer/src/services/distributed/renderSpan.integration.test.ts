import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderJob, executeRenderJob, RenderCancelledError } from "../renderOrchestrator.js";
import { renderSpan } from "./renderSpan.js";

const ROOT_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
<style>html,body{margin:0;width:160px;height:90px;overflow:hidden;background:#0f172a}
#main{position:relative;width:160px;height:90px}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(120px)}}
@keyframes ramp{from{background:#000}to{background:#fff}}
#bg{position:absolute;inset:0;animation:ramp 3s linear forwards}
#box{position:absolute;left:0;top:10px;width:30px;height:30px;background:#f97316;animation:slide 3s linear forwards}
#sub{position:absolute;inset:0}</style></head>
<body><div id="main" data-composition-id="main" data-width="160" data-height="90" data-start="0" data-duration="3">
<div id="bg"></div>
<div id="box"></div>
<div id="sub" data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="1" data-duration="1" data-track-index="1"></div>
</div>
<script>const tl=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;tl.to({},{duration:3},0);</script>
</body></html>`;

const SUB_HTML = `<template id="sub-template">
<div id="sub-root" data-composition-id="sub" data-start="0" data-duration="1" data-width="160" data-height="90">
<div id="chip"></div></div>
<style>[data-composition-id="sub"]{position:absolute;inset:0;width:160px;height:90px}
@keyframes grow{from{width:10px}to{width:150px}}
[data-composition-id="sub"] #chip{position:absolute;left:5px;top:60px;height:20px;width:10px;background:#22c55e;animation:grow 1s linear forwards}</style>
<script>const t=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines["sub"]=t;t.to({},{duration:1},0);</script>
</template>`;

function frames(path: string): Buffer[] {
  const out = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 28 },
  );
  const size = 160 * 90 * 3;
  const all = out.stdout;
  return Array.from({ length: Math.floor(all.length / size) }, (_, i) =>
    all.subarray(i * size, (i + 1) * size),
  );
}

function meanDiff(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

describe("renderSpan", () => {
  let root: string;
  let projectDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-render-span-"));
    projectDir = join(root, "project");
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(join(projectDir, "index.html"), ROOT_HTML);
    writeFileSync(join(projectDir, "compositions", "sub.html"), SUB_HTML);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("renders the frames of the span the way a full render renders them, sub-composition included", async () => {
    const fullPath = join(root, "full.mp4");
    const job = createRenderJob({ fps: { num: 30, den: 1 }, quality: "draft", format: "mp4" });
    await executeRenderJob(job, projectDir, fullPath);

    const spanPath = join(root, "span.mp4");
    const { framesEncoded } = await renderSpan(
      projectDir,
      { fps: 30, width: 160, height: 90, format: "mp4", quality: "draft", hdrMode: "force-sdr" },
      { startSeconds: 0.5, endSeconds: 2 },
      spanPath,
    );
    expect(framesEncoded).toBe(45);

    const full = frames(fullPath);
    const span = frames(spanPath);
    expect(span.length).toBe(45);
    const worstMatch = Math.max(...span.map((frame, i) => meanDiff(frame, full[15 + i]!)));
    // The backdrop brightens about 2.8 levels a frame, so a span one frame off its place misses by more than this.
    expect(worstMatch).toBeLessThan(1.5);
    const oneFrameLate = span.map((frame, i) => meanDiff(frame, full[16 + i]!));
    expect(Math.min(...oneFrameLate)).toBeGreaterThan(worstMatch);
  }, 240_000);

  it("stops when it is cancelled after planning, with no output written", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch, { recursive: true });
    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    const controller = new AbortController();
    const outputPath = join(root, "cancelled.mp4");
    try {
      const running = renderSpan(
        projectDir,
        {
          fps: 30,
          width: 160,
          height: 90,
          format: "mp4",
          quality: "draft",
          hdrMode: "force-sdr",
          chunkSize: 15,
          abortSignal: controller.signal,
        },
        { startSeconds: 0 },
        outputPath,
      );
      const firstPart = () =>
        readdirSync(scratch).some((dir) =>
          existsSync(join(scratch, dir, "parts", "part-0000.mp4")),
        );
      while (!firstPart()) await new Promise((done) => setTimeout(done, 20));
      controller.abort();
      await expect(running).rejects.toBeInstanceOf(RenderCancelledError);
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      if (previousTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmp;
    }
  }, 240_000);
});

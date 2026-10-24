import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { diffVideos, pickedFrames, selectFilter } from "./diff.js";
import { parseSegments } from "./segments.js";

const ffmpeg = findFFmpeg();
const noTools = !ffmpeg || !findFFprobe();
const dir = mkdtempSync(join(tmpdir(), "hf-diff-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A lossless synthetic clip, so SSIM differences come from the picture, not the encoder. */
function clip(name: string, args: string[]): string {
  const out = join(dir, name);
  execFileSync(ffmpeg!, [
    ...["-hide_banner", "-loglevel", "error", "-y", ...args],
    ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "0", out],
  ]);
  return out;
}

describe("parseSegments", () => {
  it("reads headings and where each window's pixels come from", () => {
    const md = [
      "# Film — reverse",
      "## S01 · 0.00–2.40 s · Title card",
      "Pixels: rebuilt",
      "## S02 · 2.40–5.00 s · Talking head",
      "Pixels: reused",
      "## S03 · 5.00–6.5 s · Product shot",
      "Pixels: regenerated",
      "## S04 · 6.5–8 s",
      "## Unknowns",
    ].join("\n");
    expect(parseSegments(md)).toEqual([
      { id: "S01", start: 0, end: 2.4, title: "Title card", pixels: "rebuilt" },
      { id: "S02", start: 2.4, end: 5, title: "Talking head", pixels: "reused" },
      { id: "S03", start: 5, end: 6.5, title: "Product shot", pixels: "regenerated" },
      { id: "S04", start: 6.5, end: 8, title: "", pixels: "rebuilt" },
    ]);
  });
});

describe("frame picks", () => {
  it("keeps a range's frames end-exclusive and renumbers them on the original's clock", () => {
    expect(pickedFrames({ kind: "range", k0: 3, k1: 6 }, 90)).toEqual([3, 4, 5]);
    expect(selectFilter({ kind: "range", k0: 3, k1: 6 }, "30000/1001")).toEqual([
      "select=between(n\\,3\\,5)",
      "setpts=N/(30000/1001)/TB",
    ]);
    expect(selectFilter({ kind: "at", ks: [2, 9] }, "30")[0]).toBe("select=eq(n\\,2)+eq(n\\,9)");
    expect(selectFilter({ kind: "all" }, "30")).toEqual([]);
  });
});

describe.skipIf(noTools)("diffVideos", () => {
  const ref = noTools ? "" : clip("ref.mp4", ["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=320x180"]);

  it("passes a video against itself", async () => {
    const r = await diffVideos({ reference: ref, yours: ref, outDir: join(dir, "same") });
    expect(r.pass).toBe(true);
    expect(r.ssim.frames).toBe(90);
    expect(r.ssim.mean).toBeGreaterThan(0.999);
    expect(r.worst).toEqual([]);
  });

  it("clears only its own worst pictures from the output folder, never an input", async () => {
    const out = join(dir, "shared");
    mkdirSync(out, { recursive: true });
    const original = join(out, "worst-original.mp4");
    copyFileSync(ref, original);
    writeFileSync(join(out, "worst-notes.txt"), "mine");
    writeFileSync(join(out, "worst-09-cell.png"), "stale");
    const r = await diffVideos({ reference: original, yours: ref, outDir: out });
    expect(r.pass).toBe(true);
    expect(existsSync(original)).toBe(true);
    expect(existsSync(join(out, "worst-notes.txt"))).toBe(true);
    expect(existsSync(join(out, "worst-09-cell.png"))).toBe(false);
  });

  it("does not let a segment that measured nothing pass a failing comparison", async () => {
    const white = clip("white.mp4", ["-f", "lavfi", "-i", "color=c=white:s=160x90:r=30:d=2"]);
    const blue = clip("blue.mp4", ["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=2"]);
    const base = { reference: white, yours: blue, range: [0, 0.5] as [number, number] };
    expect((await diffVideos({ ...base, outDir: join(dir, "wb") })).pass).toBe(false);
    const segments = [{ id: "S01", start: 1, end: 2, title: "", pixels: "rebuilt" as const }];
    const r = await diffVideos({ ...base, segments, outDir: join(dir, "wb-seg") });
    expect(r.segments![0]!.pass).toBeNull();
    expect(r.pass).toBe(false);
  });

  it("fails sound that starts a second late and passes a steady tone against itself", async () => {
    // Uneven beeps, so only one offset lines them up.
    const beeps = (shift: number) =>
      [0.5, 1.4, 2.0, 3.1, 3.5, 4.6]
        .map((t) => `between(t,${t + shift},${t + shift + 0.1})`)
        .join("+");
    const withSound = (name: string, gain: string) =>
      clip(name, [
        ...["-f", "lavfi", "-i", "color=c=gray:s=160x90:r=30:d=6"],
        ...["-f", "lavfi", "-i", "sine=f=440:d=6", "-af", `volume='${gain}':eval=frame`],
        ...["-c:a", "aac", "-shortest"],
      ]);
    const on = withSound("on.mp4", `if(${beeps(0)},1,0)`);
    const late = withSound("late.mp4", `if(${beeps(1)},1,0)`);
    const off = await diffVideos({ reference: on, yours: late, outDir: join(dir, "late") });
    expect(off.sound!.pass).toBe(false);
    expect(off.pass).toBe(false);
    const tone = withSound("tone.mp4", "1");
    const steady = await diffVideos({ reference: tone, yours: tone, outDir: join(dir, "tone") });
    expect(steady.sound!.pass).not.toBe(false);
    expect(steady.pass).toBe(true);
  });

  it("passes a regenerated segment of grey footage or a still shot against itself", async () => {
    const grey = clip("grey.mp4", [
      ...["-f", "lavfi", "-i", "testsrc2=d=2:r=30:s=160x90"],
      "-vf",
      "hue=s=0",
    ]);
    const still = clip("still.mp4", ["-f", "lavfi", "-i", "color=c=0x336699:s=160x90:r=30:d=2"]);
    const segments = [{ id: "S01", start: 0, end: 2, title: "", pixels: "regenerated" as const }];
    for (const [name, v] of [
      ["grey", grey],
      ["still", still],
    ] as const) {
      const r = await diffVideos({
        reference: v,
        yours: v,
        segments,
        outDir: join(dir, `regen-${name}`),
      });
      expect(r.segments![0]!.pass).toBe(true);
      expect(r.pass).toBe(true);
    }
  });

  it("finds a wrong element by its cell when the whole frame still scores high", async () => {
    // An 80x60 box over a 320x180 frame for one second: about 0.94 whole-frame SSIM.
    const yours = clip("box.mp4", [
      ...["-i", ref, "-vf"],
      "drawbox=x=40:y=40:w=80:h=60:color=red:t=fill:enable='between(t,1,2)'",
    ]);
    const r = await diffVideos({ reference: ref, yours, outDir: join(dir, "box") });
    expect(r.ssim.mean).toBeGreaterThan(0.92);
    expect(r.ssim.cell_p05).toBeLessThan(0.8);
    expect(r.pass).toBe(false);
    const [first] = r.worst;
    expect(first!.t).toBeGreaterThanOrEqual(1);
    expect(first!.t).toBeLessThanOrEqual(2);
    const [x, y, w, h] = first!.cell.roi;
    expect(x < 120 && x + w > 40 && y < 100 && y + h > 40).toBe(true);
    expect(existsSync(r.sheet!)).toBe(true);
  });

  it("draws the worst cell of a tall frame scaled for the sheet", async () => {
    // 1080x1920 scales to 960x1706 for the sheet; the bottom row's box rounds a pixel past the edge.
    const tall = clip("tall.mp4", ["-f", "lavfi", "-i", "testsrc2=d=1:r=30:s=1080x1920"]);
    const yours = clip("tall-box.mp4", [
      ...["-i", tall, "-vf"],
      "drawbox=x=0:y=1500:w=1080:h=420:color=red:t=fill",
    ]);
    const r = await diffVideos({ reference: tall, yours, outDir: join(dir, "tall") });
    expect(r.worst.length).toBeGreaterThan(0);
    expect(r.worst[0]!.cell.roi[1]).toBe(1440);
  });

  it("fails a scene left empty on a plain background", async () => {
    // A small dark label on white, gone from yours after 1.5 s: still about 0.97 whole-frame SSIM.
    const label = "drawbox=x=40:y=20:w=36:h=12:color=0x303030:t=fill";
    const page = clip("page.mp4", [
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=320x180:r=30:d=3",
      "-vf",
      label,
    ]);
    const yours = clip("emptied.mp4", [
      ...["-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=3", "-vf"],
      `${label}:enable='lt(t,1.5)'`,
    ]);
    const r = await diffVideos({ reference: page, yours, outDir: join(dir, "emptied") });
    expect(r.missing_content.pass).toBe(false);
    expect(r.missing_content.share).toBeGreaterThan(0.45);
    expect(r.missing_content.spans[0]![0]).toBeCloseTo(1.5, 1);
    expect(r.pass).toBe(false);
    const same = await diffVideos({ reference: page, yours: page, outDir: join(dir, "page") });
    expect(same.missing_content).toMatchObject({ share: 0, pass: true });
  });

  it("scores only a range, on the original's frame numbers", async () => {
    const yours = clip("late.mp4", [
      ...["-i", ref, "-vf"],
      "drawbox=x=0:y=0:w=320:h=180:color=black:t=fill:enable='gte(t,2)'",
    ]);
    const r = await diffVideos({
      reference: ref,
      yours,
      range: [0.5, 1.5],
      outDir: join(dir, "range"),
    });
    expect(r.ssim.frames).toBe(30);
    expect(r.window).toEqual([0.5, 1.5]);
    expect(r.pass).toBe(true);
  });

  it("reports a cut a few frames late as missing and extra", async () => {
    const two = (name: string, at: number) =>
      clip(name, [
        ...["-f", "lavfi", "-i", `color=c=0x2050c0:s=320x180:r=30:d=${at}`],
        ...["-f", "lavfi", "-i", `color=c=0xe0c040:s=320x180:r=30:d=${3 - at}`],
        ...["-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]"],
      ]);
    const r = await diffVideos({
      reference: two("cut-ref.mp4", 1),
      yours: two("cut-late.mp4", 1.1),
      outDir: join(dir, "cuts"),
    });
    expect(r.cuts?.reference).toEqual([1]);
    expect(r.cuts?.missing).toEqual([1]);
    expect(r.cuts?.extra).toEqual([1.1]);
    expect(r.pass).toBe(false);
  });

  it("judges a regenerated segment by motion and look, not pixels", async () => {
    const shifted = clip("shifted.mp4", [...["-i", ref, "-vf"], "hflip"]);
    const segments = parseSegments("## S01 · 0–3 s · AI shot\nPixels: regenerated\n");
    const r = await diffVideos({
      reference: ref,
      yours: shifted,
      segments,
      outDir: join(dir, "regen"),
    });
    expect(r.ssim.mean).toBeLessThan(0.9);
    expect(r.segments?.[0]?.energy?.mean_ratio).toBeCloseTo(1, 1);
    expect(r.segments?.[0]?.pass).toBe(true);
  });
});

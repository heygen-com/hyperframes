import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clipFolder,
  diffVerdicts,
  loadOpenCvFirst,
  noTools,
  REF_ARGS,
} from "./diff.test-helpers.js";
import { parseSegments } from "./segments.js";

const { dir, clip } = clipFolder("hf-diff-seg-test-");

describe.skipIf(noTools)("diffVideos with segments", () => {
  loadOpenCvFirst();
  const ref = noTools ? "" : clip("ref.mp4", REF_ARGS);

  it("judges a rebuilt segment's regenerated region by motion and look, the rest by SSIM", async () => {
    // The bottom half mirrored, as a re-shot presenter differs in pixels but moves the same.
    const mixed = clip("mixed.mp4", [
      ...["-i", ref, "-filter_complex"],
      "[0]split[a][b];[b]crop=320:90:0:90,hflip[f];[a][f]overlay=0:90",
    ]);
    const md = "## S01 · 0–3 s · Board over a presenter\nPixels: rebuilt\n";
    const plain = await diffVerdicts({
      reference: ref,
      yours: mixed,
      segments: parseSegments(md),
      outDir: join(dir, "mixed-plain"),
    });
    expect(plain.segments?.[0]?.pass).toBe(false);
    const r = await diffVerdicts({
      reference: ref,
      yours: mixed,
      segments: parseSegments(`${md}Regenerated: 0, 0.5, 1, 0.5\n`),
      outDir: join(dir, "mixed"),
    });
    const [s] = r.segments!;
    expect(s!.ssim!.mean).toBeGreaterThan(0.99);
    expect(s!.regenerated?.roi).toEqual([0, 90, 320, 90]);
    expect(s!.person?.energy?.mean_ratio).toBeCloseTo(1, 1);
    expect(s!.pass).toBe(true);
    // A wrong box outside the region still fails the segment.
    const boxed = clip("mixed-box.mp4", [
      ...["-i", mixed, "-vf"],
      "drawbox=x=20:y=10:w=60:h=40:color=red:t=fill",
    ]);
    const bad = await diffVerdicts({
      reference: ref,
      yours: boxed,
      segments: parseSegments(`${md}Regenerated: 0, 0.5, 1, 0.5\n`),
      outDir: join(dir, "mixed-box"),
    });
    expect(bad.segments?.[0]?.pass).toBe(false);
  });

  // A label (three white strokes) over a soft bottom half, a regenerated person (here 5 frames late); yours
  // draws it 24 px off. Two tests of two comparisons each, so neither nears the per-test limit on a busy runner.
  const strokes = (x0: number) =>
    [0, 14, 28].map((x) => `drawbox=x=${x0 + x}:y=110:w=6:h=24:color=white:t=fill`).join(",");
  const soft = (delay: number) =>
    `[0]split[a][b];[b]crop=320:90:0:90,gblur=sigma=10,hue=s=0.4,tpad=start=${delay}:start_mode=clone[f];[a][f]overlay=0:90:shortest=1`;
  const labelled = (name: string, delay: number, x0: number) =>
    noTools ? "" : clip(name, [...["-i", ref, "-filter_complex"], `${soft(delay)},${strokes(x0)}`]);
  const base = labelled("label-ref.mp4", 0, 120);
  const right = labelled("label-right.mp4", 5, 120);
  const off = labelled("label-off.mp4", 5, 144);
  const md =
    "## S01 · 0–3 s · Label over a presenter\nPixels: rebuilt\nRegenerated: 0, 90, 320, 90\n";
  const judge = (yours: string, text: string, name: string) =>
    diffVerdicts({
      reference: base,
      yours,
      segments: parseSegments(text),
      outDir: join(dir, name),
    });

  it("hides a drawn element in a regenerated region without a Drawn line, and flags a box over the whole frame", async () => {
    expect((await judge(off, md, "drawn-hidden")).segments?.[0]?.pass).toBe(true);
    const whole = await judge(right, md.replace("0, 90, 320, 90", "0, 0, 320, 180"), "drawn-whole");
    expect(whole.warnings.some((w) => w.includes("covers the whole frame"))).toBe(true);
  });

  it("judges each drawn element inside a regenerated region by itself, not by what is behind it", async () => {
    const drawn = `${md}Drawn: 118, 108, 42, 28\n`;
    const good = (await judge(right, drawn, "drawn-right")).segments![0]!;
    expect(good.pass).toBe(true);
    expect(good.drawn?.[0]).toMatchObject({ id: "S01.D1", box: [118, 108, 42, 28], pass: true });
    expect(good.scored).toContain("1 drawn elements, each scored by itself");
    const bad = await judge(off, drawn, "drawn-off");
    expect(bad.segments?.[0]?.pass).toBe(false);
    expect(bad.segments?.[0]?.drawn?.[0]?.pass).toBe(false);
  });

  it("scores a drawn element by itself without segments, and its ink says when yours is thinner", async () => {
    // The same three-stroke label over two different flat backdrops; yours draws it at half the stroke width.
    const strokes = (w: number) =>
      [0, 14, 28].map((x) => `drawbox=x=${120 + x}:y=110:w=${w}:h=24:color=white:t=fill`).join(",");
    const backdrop = (colour: string) => [
      "-f",
      "lavfi",
      "-i",
      `color=c=${colour}:s=320x180:d=3:r=30`,
    ];
    const base = clip("solo-ref.mp4", [...backdrop("0x305070"), "-vf", strokes(6)]);
    const right = clip("solo-right.mp4", [...backdrop("0x604030"), "-vf", strokes(6)]);
    const thin = clip("solo-thin.mp4", [...backdrop("0x604030"), "-vf", strokes(3)]);
    const box: [number, number, number, number] = [116, 106, 44, 32];
    const good = await diffVerdicts({
      reference: base,
      yours: right,
      at: [0.5, 1, 1.5, 2],
      drawn: [{ box }, { box, window: [1, 3] }],
      outDir: join(dir, "solo-right"),
    });
    expect(good.segments).toBeUndefined();
    expect(good.drawn).toHaveLength(2);
    expect(good.drawn?.[0]).toMatchObject({ id: "D1", box, window: [0, 3], frames: 4, pass: true });
    expect(good.drawn?.[1]).toMatchObject({ id: "D2", window: [1, 3], frames: 3, pass: true });
    const bad = await diffVerdicts({
      reference: base,
      yours: thin,
      at: [0.5, 1, 1.5, 2],
      drawn: [{ box }],
      outDir: join(dir, "solo-thin"),
    });
    expect(good.drawn?.[0]).toMatchObject({ score: 1, offset: [0, 0], ink: 1 });
    // Half-weight letters in the right place: the score barely drops, the ink says it.
    expect(bad.drawn?.[0]?.score).toBeLessThan(0.9);
    expect(bad.drawn?.[0]?.ink).toBe(0.5);
  });
});

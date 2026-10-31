import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cellsOutside,
  diffVideos,
  longRuns,
  pickedFrames,
  regionRoi,
  selectFilter,
  wholeFrameCuts,
} from "./diff.js";
import {
  clipFolder,
  diffVerdicts,
  loadOpenCvFirst,
  noTools,
  REF_ARGS,
} from "./diff.test-helpers.js";
import { carriedFrame, shotFraming, syncPass } from "./person.js";
import { parseSegments } from "./segments.js";

const { dir, clip } = clipFolder("hf-diff-test-");

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

  it("reads a regenerated region inside a rebuilt segment, in pixels or shares", () => {
    const md = [
      "## S01 · 0–2 s · Board under the presenter",
      "Pixels: rebuilt",
      "Regenerated: 0, 95, 720, 600 (the re-shot presenter)",
      "## S02 · 2–4 s",
      "Regenerated: 0 0.5 1 0.5",
      "## S03 · 4–6 s",
      "Pixels: regenerated",
      "Regenerated: 0, 0, 10, 10",
    ].join("\n");
    const [a, b, c] = parseSegments(md);
    expect(a!.regenerated).toEqual([0, 95, 720, 600]);
    expect(b!.regenerated).toEqual([0, 0.5, 1, 0.5]);
    expect(c!.regenerated).toBeUndefined();
  });

  it("reads drawn elements over a regenerated person, and whether a segment quotes copy", () => {
    const md = [
      "## S01 · 0–2 s · Title over the presenter",
      "Pixels: rebuilt",
      "Regenerated: 0, 0, 608, 1080",
      'Copy: "IS NO" / "LONGER"',
      "Drawn: 110, 615, 390, 165 (the title)",
      "Drawn: 40 40 120 120, logo 0.5–1.5 s",
      "## S02 · 2–4 s",
      "Copy: none, footage only",
    ].join("\n");
    const [a, b] = parseSegments(md);
    expect(a!.drawn).toEqual([
      { box: [110, 615, 390, 165] },
      { box: [40, 40, 120, 120], window: [0.5, 1.5] },
    ]);
    expect(a!.copy).toBe(true);
    expect(b!.drawn).toBeUndefined();
    expect(b!.copy).toBeUndefined();
  });
});

describe("whole-frame cuts", () => {
  it("keeps the ledger's cuts and stills from the original that cover the whole frame", () => {
    const ledger = [
      {
        type: "video",
        provenance: { provider: "original", window: [0, 12.267], roi: [0, 0, 720, 1280] },
      },
      { type: "video", provenance: { provider: "original", window: [1, 2] } },
      {
        type: "video",
        provenance: { provider: "original", window: [3, 4], roi: [0, 0, 720, 704] },
      },
      { type: "image", provenance: { provider: "original", at: 3, roi: [0, 0, 720, 1280] } },
      { type: "image", provenance: { provider: "original", at: 5, roi: [60, 260, 480, 560] } },
      { type: "video", provenance: { provider: "heygen", window: [0, 5] } },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    expect(wholeFrameCuts(`${ledger}\nnot json`, 720, 1280)).toEqual({
      windows: [
        [0, 12.267],
        [1, 2],
      ],
      stills: [3],
    });
  });

  it("drops runs of frames shorter than the minimum", () => {
    const on = [true, true, false, true, true, true, true, true];
    expect(longRuns(on, [0, 1, 2, 3, 4, 5, 9, 10], 3)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("regenerated regions", () => {
  it("scales shares to pixels, clips to the frame and leaves the covered cells to the region", () => {
    expect(regionRoi([0, 0.5, 1, 0.5], 320, 180)).toEqual([0, 90, 320, 90]);
    expect(regionRoi([600, 1200, 400, 200], 720, 1280)).toEqual([600, 1200, 120, 80]);
    // 80x44 cells: the bottom half covers rows 2 and 3 (row 2 from y 88, all but 2 px of it).
    expect(cellsOutside([0, 90, 320, 90], 320, 180)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("person gates", () => {
  const at = (t: number, ...boxes: number[][]) => ({ t, boxes });
  const face = [0.4, 0.3, 0.2, 0.12];
  const original = [0, 0.4, 0.8, 1.2].map((t) => at(t, face));

  it("fails a shot's framing only when the face sits clearly off the original's", () => {
    const moved = (dy: number, grow = 1) =>
      [0, 0.4, 0.8, 1.2].map((t) => at(t, [0.4, 0.3 + dy, 0.2 * grow, 0.12 * grow]));
    expect(shotFraming([0, 1.5], original, moved(0.01))).toMatchObject({ pass: true });
    // Half a face height lower, or 40% bigger.
    expect(shotFraming([0, 1.5], original, moved(0.06))).toMatchObject({ pass: false });
    expect(shotFraming([0, 1.5], original, moved(0, 1.4))).toMatchObject({ pass: false });
    // One stray moment off (a hand over the face, a photo) is not a framing.
    const stray = original.map((m, i) => (i === 1 ? at(m.t, [0.4, 0.6, 0.2, 0.12]) : m));
    expect(shotFraming([0, 1.5], original, stray)).toMatchObject({ pass: true });
    // Another face in yours (a picture on the wall) does not stand in for the person.
    const crowd = [0, 0.4, 0.8, 1.2].map((t) => at(t, [0.05, 0.05, 0.3, 0.2], face));
    expect(shotFraming([0, 1.5], original, crowd)).toMatchObject({
      shift: 0,
      pass: true,
    });
    // Too few faces to judge.
    expect(shotFraming([0, 0.5], original, original)).toBeUndefined();
  });

  it("judges lips only on a confident reading, inside +45 / −125 ms", () => {
    expect(syncPass({ best_lag_ms: 30, confidence: "high" })).toBe(true);
    expect(syncPass({ best_lag_ms: -120, confidence: "high" })).toBe(true);
    expect(syncPass({ best_lag_ms: 80, confidence: "high" })).toBe(false);
    expect(syncPass({ best_lag_ms: -200, confidence: "high" })).toBe(false);
    expect(syncPass({ best_lag_ms: -300, confidence: "medium" })).toBeNull();
  });

  it("finds the original's letters in a generated clip, not the place they share", () => {
    // A textured place (the same in the original, the clean still and the clip) and white letters over it.
    const [w, h] = [60, 30];
    const place = new Uint8Array(w * h * 3).map((_, i) => 60 + ((i * 37) % 50));
    const lettered = (px: Uint8Array) => {
      const out = new Uint8Array(px);
      for (let y = 8; y < 22; y++)
        for (const x0 of [10, 25, 40])
          for (let x = x0; x < x0 + 4; x++) out.set([255, 255, 255], (y * w + x) * 3);
      return out;
    };
    const original = lettered(place);
    expect(carriedFrame(original, lettered(place), place, w, h, undefined)).toBeGreaterThan(0.9);
    expect(carriedFrame(original, place, place, w, h, undefined)).toBeLessThan(0.1);
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
  loadOpenCvFirst();
  const ref = noTools ? "" : clip("ref.mp4", REF_ARGS);

  it("passes a video against itself", async () => {
    const r = await diffVideos({ reference: ref, yours: ref, outDir: join(dir, "same") });
    expect(r.pass).toBe(true);
    expect(r.ssim.frames).toBe(90);
    expect(r.ssim.mean).toBeGreaterThan(0.999);
    expect(r.worst).toEqual([]);
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
    const r = await diffVerdicts({ reference: page, yours, outDir: join(dir, "emptied") });
    expect(r.missing_content.pass).toBe(false);
    expect(r.missing_content.share).toBeGreaterThan(0.45);
    expect(r.missing_content.spans[0]![0]).toBeCloseTo(1.5, 1);
    expect(r.pass).toBe(false);
    const same = await diffVerdicts({ reference: page, yours: page, outDir: join(dir, "page") });
    expect(same.missing_content).toMatchObject({ share: 0, pass: true });
    // A regenerated segment's picture is its own: what it leaves out is not missing.
    const regen = await diffVerdicts({
      reference: page,
      yours,
      segments: parseSegments("## S01 · 0–3 s · AI shot\nPixels: regenerated\n"),
      outDir: join(dir, "emptied-regen"),
    });
    expect(regen.missing_content).toMatchObject({ share: 0, pass: true });
  });

  it("reports missing texture apart from missing shapes, without failing it", async () => {
    // A fine 4 px checker in the bottom-left cell: flat at an eighth of the width, so texture, not structure.
    const checker =
      "if(lt(X\\,80)*gte(Y\\,135)\\,if(mod(floor(X/4)+floor(Y/4)\\,2)\\,60\\,200)\\,235)";
    const grain = clip("grain.mp4", [
      ...["-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=2", "-vf"],
      `format=gray,geq=lum='${checker}',format=yuv420p`,
    ]);
    const plain = clip("plain.mp4", [
      ...["-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=2", "-vf"],
      "format=gray,geq=lum=235,format=yuv420p",
    ]);
    const r = await diffVerdicts({ reference: grain, yours: plain, outDir: join(dir, "grain") });
    expect(r.missing_content).toMatchObject({ share: 0, pass: true });
    expect(r.missing_content.texture.share).toBeGreaterThan(0.9);
    expect(r.warnings.some((w) => w.includes("reported, not failed"))).toBe(true);
  });

  it("scores only a range, on the original's frame numbers", async () => {
    const yours = clip("late.mp4", [
      ...["-i", ref, "-vf"],
      "drawbox=x=0:y=0:w=320:h=180:color=black:t=fill:enable='gte(t,2)'",
    ]);
    const r = await diffVerdicts({
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
    const r = await diffVerdicts({
      reference: two("cut-ref.mp4", 1),
      yours: two("cut-late.mp4", 1.1),
      outDir: join(dir, "cuts"),
    });
    expect(r.cuts?.reference).toEqual([1]);
    expect(r.cuts?.missing).toEqual([1]);
    expect(r.cuts?.extra).toEqual([1.1]);
    expect(r.pass).toBe(false);
  });

  it("matches a soft cut in the original with a hard one in yours", async () => {
    // Grey 0x80 to 0x8b changes the signature by 10 levels: a soft cut. Yours jumps further on the same frame.
    const step = (name: string, to: string, at: number) =>
      clip(name, [
        ...["-f", "lavfi", "-i", `color=c=0x808080:s=320x180:r=30:d=${at}`],
        ...["-f", "lavfi", "-i", `color=c=${to}:s=320x180:r=30:d=${3 - at}`],
        ...["-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]"],
      ]);
    const soft = step("soft-ref.mp4", "0x8b8b8b", 1);
    const r = await diffVerdicts({
      reference: soft,
      yours: step("soft-hard.mp4", "0xa0a0a0", 1),
      outDir: join(dir, "soft"),
    });
    expect(r.cuts).toMatchObject({ reference: [1], missing: [], extra: [], pass: true });
    const late = await diffVerdicts({
      reference: soft,
      yours: step("soft-late.mp4", "0xa0a0a0", 1.2),
      outDir: join(dir, "soft-late"),
    });
    expect(late.cuts).toMatchObject({ missing: [1], extra: [1.2], pass: false });
  });
});

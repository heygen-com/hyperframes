import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureTimes,
  clipPick,
  diffVideos,
  overlapFrames,
  parseOffset,
  yoursFilters,
  type DiffResult,
} from "./diff.js";
import {
  clipFolder,
  diffVerdicts,
  loadOpenCvFirst,
  noTools,
  REF_ARGS,
} from "./diff.test-helpers.js";
import { Fix } from "./media.js";

const { dir, clip } = clipFolder("hf-diff-offset-test-");

describe("offset frame times", () => {
  it("reads yours from t + offset, and as before with no offset", () => {
    expect(yoursFilters({ kind: "all" }, "30")).toEqual(["fps=30"]);
    expect(yoursFilters({ kind: "all" }, "30", 0)).toEqual(["fps=30"]);
    expect(yoursFilters({ kind: "range", k0: 3, k1: 6 }, "30", 0.5)).toEqual([
      "fps=30:start_time=0.5",
      "select=between(n\\,3\\,5)",
      "setpts=N/(30)/TB",
    ]);
    expect(yoursFilters({ kind: "all" }, "30000/1001", -0.25)).toEqual([
      "fps=30000/1001:start_time=-0.25",
      "setpts=N/(30000/1001)/TB",
    ]);
    expect(yoursFilters({ kind: "all" }, "30", 0.5)).toEqual([
      "fps=30:start_time=0.5",
      "setpts=N/(30)/TB",
    ]);
  });

  it("captures a project at each frame's time plus the offset", () => {
    expect(captureTimes([0, 15, 30], 30)).toEqual([0, 0.5, 1]);
    expect(captureTimes([0, 15, 30], 30, 0.5)).toEqual([0.5, 1, 1.5]);
    expect(captureTimes([15, 30], 30, -0.5)).toEqual([0, 0.5]);
  });

  it("keeps the original's frames that land on yours, for either sign", () => {
    // 3 s at 30 fps on both sides.
    expect(overlapFrames(90, 30, 0.5, 90)).toEqual([0, 75]);
    expect(overlapFrames(90, 30, -0.5, 90)).toEqual([15, 90]);
    // Yours 3.5 s: a half-second lead-in leaves every frame of the original inside it.
    expect(overlapFrames(90, 30, 0.5, 105)).toEqual([0, 90]);
    expect(overlapFrames(90, 30, -0.1, 90)).toEqual([3, 90]);
    // A project's end is not known before capture: only its start bounds the window.
    expect(overlapFrames(90, 30, 2, undefined)).toEqual([0, 90]);
    expect(overlapFrames(90, 30, -2, undefined)).toEqual([60, 90]);
    expect(overlapFrames(90, 30, 5, 90)).toEqual([0, 0]);
    expect(overlapFrames(90, 30, -5, 90)).toEqual([90, 90]);
  });

  it("clips each kind of pick to the overlap", () => {
    expect(clipPick({ kind: "all" }, 90, [0, 90])).toEqual({ kind: "all" });
    expect(clipPick({ kind: "all" }, 90, [15, 90])).toEqual({ kind: "range", k0: 15, k1: 90 });
    expect(clipPick({ kind: "range", k0: 10, k1: 80 }, 90, [0, 75])).toEqual({
      kind: "range",
      k0: 10,
      k1: 75,
    });
    expect(clipPick({ kind: "at", ks: [3, 20, 80] }, 90, [15, 75])).toEqual({
      kind: "at",
      ks: [20],
    });
  });

  it("reads a number of seconds, negative too, and refuses anything else with a fix", () => {
    expect(parseOffset("0.5")).toBe(0.5);
    expect(parseOffset("-0.5")).toBe(-0.5);
    expect(parseOffset(" 2 ")).toBe(2);
    for (const bad of [
      "",
      "abc",
      "0.5s",
      "1,2",
      "0x10",
      "Infinity",
      "1e309",
      "+1e309",
      "-1e309",
      true,
    ])
      expect(() => parseOffset(bad)).toThrow(Fix);
    try {
      parseOffset("abc");
    } catch (err) {
      expect(err instanceof Fix && err.fix).toContain("--offset 0.5");
    }
  });
});

describe.skipIf(noTools)("diffVideos with an offset", () => {
  loadOpenCvFirst();
  const ref = noTools ? "" : clip("ref.mp4", REF_ARGS);
  // Half a second of black, then the original's first 2.5 s: yours runs 0.5 s behind, 3 s long.
  const late = noTools
    ? ""
    : clip("late.mp4", [
        ...["-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=0.5", "-i", ref],
        ...["-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]", "-t", "3"],
      ]);
  // The original from 0.5 s: yours runs 0.5 s ahead.
  const early = noTools ? "" : clip("early.mp4", ["-ss", "0.5", "-i", ref]);

  it("compares the original at t with a late render at t + offset, clipped to its end", async () => {
    const off = await diffVerdicts({ reference: ref, yours: late, outDir: join(dir, "late-0") });
    expect(off.pass).toBe(false);
    const r = await diffVerdicts({
      reference: ref,
      yours: late,
      offset: 0.5,
      outDir: join(dir, "late"),
    });
    expect(r.offset).toBe(0.5);
    expect(r.ssim.frames).toBe(75);
    expect(r.ssim.mean).toBeGreaterThan(0.99);
    expect(r.window).toEqual([0, 2.5]);
    expect(r.warnings.join(" ")).toContain("15 of 90 frames fall outside yours");
    expect(r.duration).toMatchObject({ pass: null });
    expect(r.duration?.note).toContain("not measured");
    expect(r.pass).toBe(true);
    const rows = readFileSync(r.frames, "utf8").trim().split("\n");
    expect(rows[0]).toBe("t\tframe\tssim\tworst_cell\tcell");
    expect(rows).toHaveLength(76);
    expect(rows[1]!.split("\t").slice(0, 2)).toEqual(["0", "0"]);
  });

  it("compares every original frame with an untrimmed late render", async () => {
    const yours = clip("late-full.mp4", ["-i", ref, "-vf", "tpad=start_duration=0.5"]);
    const r = await diffVerdicts({
      reference: ref,
      yours,
      offset: 0.5,
      outDir: join(dir, "late-full"),
    });
    expect(r.ssim.mean).toBeGreaterThan(0.99);
    expect(r.ssim.frames).toBe(90);
    expect(r.window).toEqual([0, 3]);
    expect(r.warnings).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("compares an early render with a negative offset, clipped to its start", async () => {
    const r = await diffVerdicts({
      reference: ref,
      yours: early,
      offset: -0.5,
      outDir: join(dir, "early"),
    });
    expect(r.ssim.frames).toBe(75);
    expect(r.ssim.mean).toBeGreaterThan(0.99);
    expect(r.window).toEqual([0.5, 3]);
    expect(r.missing_content.pass).toBe(true);
    expect(r.pass).toBe(true);
    const first = readFileSync(r.frames, "utf8").split("\n")[1]!.split("\t");
    expect(first.slice(0, 2)).toEqual(["0.5", "15"]);
  });

  it("matches yours' cuts after taking the offset off them", async () => {
    const cut = (name: string, lead: number) =>
      clip(name, [
        ...["-f", "lavfi", "-i", `color=c=0x2050c0:s=320x180:r=30:d=${1 + lead}`],
        ...["-f", "lavfi", "-i", `color=c=0xe0c040:s=320x180:r=30:d=2`],
        ...["-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]"],
      ]);
    const [reference, yours] = [cut("cut-ref.mp4", 0), cut("cut-late.mp4", 0.5)];
    const plain = await diffVerdicts({ reference, yours, outDir: join(dir, "cut-0") });
    expect(plain.cuts).toMatchObject({ missing: [1], extra: [1.5], pass: false });
    const r = await diffVerdicts({ reference, yours, offset: 0.5, outDir: join(dir, "cut") });
    expect(r.cuts).toMatchObject({
      reference: [1],
      yours: [1],
      missing: [],
      extra: [],
      pass: true,
    });
  });

  it("refuses an offset that leaves no overlap", async () => {
    for (const options of [{ offset: 5 }, { offset: -5 }, { offset: 0.5, at: [2.8] }])
      await expect(
        diffVerdicts({ reference: ref, yours: late, outDir: join(dir, "none"), ...options }),
      ).rejects.toThrow(/leaves no overlap/);
  });

  it("writes the same frames and result at offset 0 as with none", async () => {
    const yours = clip("box.mp4", [
      ...["-i", ref, "-vf"],
      "drawbox=x=40:y=40:w=80:h=60:color=red:t=fill:enable='between(t,1,2)'",
    ]);
    const out = join(dir, "zero");
    const read = () => ["frames.tsv", "ssim.log"].map((f) => readFileSync(join(out, f)));
    const none = await diffVideos({ reference: ref, yours, outDir: out });
    const before = read();
    const zero = await diffVideos({ reference: ref, yours, offset: 0, outDir: out });
    expect(read()).toEqual(before);
    expect("offset" in none).toBe(false);
    const { offset, ...rest }: DiffResult = zero;
    expect(offset).toBe(0);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(none));
  });
});

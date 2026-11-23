import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { soundOffset } from "./diff.js";
import {
  clipFolder,
  diffVerdicts,
  ffmpeg,
  loadOpenCvFirst,
  noTools,
  REF_ARGS,
} from "./diff.test-helpers.js";
import { probeVideo } from "./media.js";
import { parseSegments } from "./segments.js";

const { dir, clip } = clipFolder("hf-diff-person-test-");

describe.skipIf(noTools)("diffVideos: copies, sound and re-shot people", () => {
  loadOpenCvFirst();
  const ref = noTools ? "" : clip("ref.mp4", REF_ARGS);

  // The ledger cuts the original's whole frame for 0–3 s. Two comparisons per test, so none nears the per-test
  // limit under the flake gate's contention.
  const ledger = join(dir, "manifest.jsonl");
  writeFileSync(
    ledger,
    JSON.stringify({
      type: "video",
      path: "assets/all.mp4",
      provenance: { provider: "original", window: [0, 3], roi: [0, 0, 320, 180] },
    }) + "\n",
  );
  const titled = '## S01 · 0–3 s · Title\nPixels: rebuilt\nCopy: "TITLE"\n';
  const reuse = (yours: string, md: string, name: string) =>
    diffVerdicts({
      reference: ref,
      yours,
      segments: parseSegments(md),
      ledger,
      outDir: join(dir, name),
    });

  it("fails the original's whole frame played where copy is meant to be rebuilt", async () => {
    const copy = await reuse(ref, titled, "copy");
    expect(copy.whole_frame_reuse).toMatchObject({ spans: [[0, 3]], drawn: [[0, 3]], pass: false });
    expect(copy.segments?.[0]?.pass).toBe(false);
    expect(copy.pass).toBe(false);
    // Footage reused with its burned-in title is a copy too (Miao, 2026-10-23: no whole-frame cut with drawn things).
    const burned = await reuse(
      ref,
      '## S01 · 0–3 s · Title over footage\nPixels: reused\nCopy: "TITLE"\n',
      "burned",
    );
    expect(burned.whole_frame_reuse).toMatchObject({ share: 1, drawn: [[0, 3]], pass: false });
  });

  it("passes footage with nothing drawn on it cut whole", async () => {
    const footage = await reuse(ref, "## S01 · 0–3 s · Footage\nPixels: reused\n", "footage");
    expect(footage.whole_frame_reuse).toMatchObject({ share: 1, drawn: [], pass: true });
    expect(footage.pass).toBe(true);
  });

  it("does not count a cut that only fed a generation as reuse", async () => {
    // A motion guide is not played: yours differs from it.
    const flipped = clip("guided.mp4", [...["-i", ref, "-vf"], "hflip"]);
    const guided = await reuse(flipped, titled, "guided");
    expect(guided.whole_frame_reuse).toMatchObject({ spans: [], pass: true });
    // A generated shot that starts from the original's first frame matches it for a few frames only: not reuse.
    const started = clip("started.mp4", [
      ...["-i", ref, "-filter_complex"],
      "[0]split[a][b];[b]hflip[f];[a][f]overlay=enable='gte(t\\,0.2)'",
    ]);
    const start = await reuse(started, titled, "started");
    expect(start.whole_frame_reuse).toMatchObject({ spans: [], pass: true });
  });

  it("finds a whole-frame still of the original shown in yours", async () => {
    const ledger = join(dir, "stills.jsonl");
    writeFileSync(
      ledger,
      [
        { type: "image", provenance: { provider: "original", at: 1, roi: [0, 0, 320, 180] } },
        { type: "image", provenance: { provider: "original", at: 2.5 } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    // Yours holds the original's frame at 1 s for the whole clip.
    const held = clip("held.mp4", [
      ...["-i", ref, "-vf"],
      "select=eq(n\\,30),loop=loop=89:size=1,setpts=N/30/TB",
    ]);
    const r = await diffVerdicts({
      reference: ref,
      yours: held,
      segments: parseSegments('## S01 · 0–3 s · Collage\nPixels: rebuilt\nCopy: "TITLE"\n'),
      ledger,
      outDir: join(dir, "held"),
    });
    expect(r.whole_frame_reuse).toMatchObject({ stills: [1], spans: [[0, 3]], pass: false });
  });

  it("reads sound that starts late as late, and the picture's length as the duration", async () => {
    // Clicks at uneven times, with the sound running 0.4 s past the picture.
    const clicks = "aevalsrc=sin(2*PI*660*t)*lt(mod(t*t*3\\,1)\\,0.08):s=48000:d=3.4";
    const voiced = (name: string, delay: number) =>
      clip(name, [
        ...["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=320x180"],
        ...["-itsoffset", String(delay), "-f", "lavfi", "-i", clicks],
        ...["-map", "0:v", "-map", "1:a", "-c:a", "aac"],
      ]);
    const on = voiced("voiced.mp4", 0);
    const same = await diffVerdicts({ reference: on, yours: on, outDir: join(dir, "voiced") });
    expect(same.duration).toMatchObject({ reference: 3, pass: true });
    expect(same.sound).toMatchObject({ offset_ms: 0, pass: true });
    const late = await diffVerdicts({
      reference: on,
      yours: voiced("late.mp4", 0.2),
      outDir: join(dir, "late"),
    });
    expect(late.sound).toMatchObject({ offset_ms: 200, pass: false });
  });

  it("places the sound by its decoded timestamps, not the start time the probe reports", () => {
    // ffmpeg 5.1 drops an HE-AAC edit list's skip twice: the first sample it keeps is timestamped 0.1 s in while
    // the probe still says the track starts at 0. Here a sound timestamped 0.25 s in, probed as starting at 0,
    // against the same sound with 0.25 s of silence baked into its samples: in sync.
    const clicks = "aevalsrc=sin(2*PI*660*t)*lt(mod(t*t*3\\,1)\\,0.08):s=48000:d=3";
    const picture = ["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=320x180"];
    const stamped = clip("stamped.mp4", [
      ...picture,
      ...["-itsoffset", "0.25", "-f", "lavfi", "-i", clicks],
      ...["-map", "0:v", "-map", "1:a", "-c:a", "pcm_s16le", "-f", "mov"],
    ]);
    const baked = clip("baked.mp4", [
      ...picture,
      ...["-f", "lavfi", "-i", clicks, "-af", "adelay=250:all=1"],
      ...["-map", "0:v", "-map", "1:a", "-c:a", "pcm_s16le", "-f", "mov"],
    ]);
    const probedAtZero = { ...probeVideo(stamped), audioStart: 0 };
    expect(soundOffset(stamped, baked, probedAtZero, probeVideo(baked))).toMatchObject({
      offset_ms: 0,
      pass: true,
    });
  });

  it("passes a re-shot person whose motion is off when the components are right", async () => {
    // The bottom half (the person) frozen on its first frame: no motion at all. Pixels above match.
    const frozen = clip("frozen.mp4", [
      ...["-i", ref, "-filter_complex"],
      "[0]split[a][b];[b]crop=320:90:0:90,trim=end_frame=1,tpad=stop=89:stop_mode=clone[f];[a][f]overlay=0:90",
    ]);
    const r = await diffVerdicts({
      reference: ref,
      yours: frozen,
      segments: parseSegments(
        "## S01 · 0–3 s · Board over a presenter\nPixels: rebuilt\nRegenerated: 0, 0.5, 1, 0.5\n",
      ),
      outDir: join(dir, "frozen"),
    });
    const [s] = r.segments!;
    expect(s!.person?.energy?.mean_ratio).toBeLessThan(0.5);
    expect(s!.person?.gates).toEqual({ framing: null, text: null, sync: null });
    expect(s!.pass).toBe(true);
    expect(r.components).toMatchObject({ passed: 1, total: 1 });
    expect(r.person?.energy).toBeLessThan(0.5);
    expect(r.pass).toBe(true);
  });

  // The original: a white label over a soft lower half (the person). Yours draws the label over a re-shot half.
  const strokes = (x0: number) =>
    [0, 14, 28].map((x) => `drawbox=x=${x0 + x}:y=110:w=6:h=24:color=white:t=fill`).join(",");
  const label = strokes(120);
  const soft = (delay: number) =>
    `[0]split[a][b];[b]crop=320:90:0:90,gblur=sigma=10,hue=s=0.4,tpad=start=${delay}:start_mode=clone[f];[a][f]overlay=0:90:shortest=1`;
  const carried = join(dir, "carried");
  // The generated clips: one made from a guide with the label on it, one from a masked guide. Yours draws the
  // label over each; over the first, 8 px off, the letters show doubled.
  const carriedRef = (): string => {
    const base = clip("carried-ref.mp4", [
      ...["-i", ref, "-filter_complex"],
      `${soft(0)},${label}`,
    ]);
    mkdirSync(join(carried, "assets"), { recursive: true });
    clip("carried/assets/dirty.mp4", [...["-i", ref, "-filter_complex"], `${soft(5)},${label}`]);
    clip("carried/assets/clean.mp4", [...["-i", ref, "-filter_complex"], soft(5)]);
    execFileSync(ffmpeg!, [
      ...["-hide_banner", "-loglevel", "error", "-y", "-i", ref, "-filter_complex"],
      `${soft(0)},trim=end_frame=1`,
      ...["-frames:v", "1", join(carried, "assets", "still.png")],
    ]);
    return base;
  };
  const carriedBase = noTools ? "" : carriedRef();
  const judgeCarried = (path: string, x0: number) => {
    const ledger = join(carried, `${path}.jsonl`);
    writeFileSync(
      ledger,
      JSON.stringify({
        type: "video",
        path: `assets/${path}.mp4`,
        provenance: { provider: "heygen", references: ["assets/still.png"], window: [0, 3] },
      }) + "\n",
    );
    return diffVerdicts({
      reference: carriedBase,
      yours: clip(`carried-yours-${path}.mp4`, [
        ...["-i", join(carried, "assets", `${path}.mp4`), "-vf"],
        strokes(x0),
      ]),
      segments: parseSegments(
        "## S01 · 0–3 s · Label over a presenter\nPixels: rebuilt\nRegenerated: 0, 90, 320, 90\nDrawn: 118, 108, 42, 28\n",
      ),
      ledger,
      project: carried,
      outDir: join(dir, `carried-${path}`),
    });
  };

  it("fails a re-shot person whose generated clip carries the original's text", async () => {
    const dirty = await judgeCarried("dirty", 128);
    expect(dirty.segments?.[0]?.person?.text?.[0]).toMatchObject({
      drawn: "S01.D1",
      carried: true,
    });
    expect(dirty.segments?.[0]?.pass).toBe(false);
    expect(dirty.person).toMatchObject({ gates: { text: false }, failed: { text: ["S01"] } });
    expect(dirty.pass).toBe(false);
  });

  it("passes a re-shot person whose generated clip came from a masked guide", async () => {
    const clean = await judgeCarried("clean", 120);
    expect(clean.segments?.[0]?.drawn?.[0]?.pass).toBe(true);
    expect(clean.segments?.[0]?.person?.gates.text).toBe(true);
    expect(clean.segments?.[0]?.pass).toBe(true);
    expect(clean.person?.shots_at_cuts).toMatchObject({
      at_cuts: 1,
      total: 1,
      cuts_without_shot: [],
    });
  });

  it("judges a regenerated segment by motion and look, not pixels", async () => {
    const shifted = clip("shifted.mp4", [...["-i", ref, "-vf"], "hflip"]);
    const segments = parseSegments("## S01 · 0–3 s · AI shot\nPixels: regenerated\n");
    const r = await diffVerdicts({
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

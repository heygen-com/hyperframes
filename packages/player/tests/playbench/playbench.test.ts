import { describe, expect, it } from "vitest";
import { analyze, type Dump, type Run } from "./analyze.ts";
import { buildEdit, compositionHtml } from "./compositions.ts";

const empty = (kind: Dump["kind"]): Dump => ({
  kind,
  events: [],
  frames: [],
  samples: [],
  params: [],
  edges: [],
  sources: [],
  tap: [],
  ctxs: [],
  rejects: 0,
});

describe("the two edits", () => {
  it("the 3-take edit is 24.8 s at 30 fps with six media elements and audio windows that overlap about 300 ms", () => {
    const edit = buildEdit("primary");
    expect(edit.takes).toHaveLength(3);
    expect(edit.takes.reduce((a, t) => a + t.dur, 0)).toBeCloseTo(24.8, 2);
    expect(edit.takes[0]!.dur).toBeCloseTo(89 / 30, 3);
    for (const [a, b] of [
      [0, 1],
      [1, 2],
    ] as const) {
      const overlap =
        edit.takes[a]!.audio.start + edit.takes[a]!.audio.dur - edit.takes[b]!.audio.start;
      expect(overlap).toBeGreaterThan(0.27);
      expect(overlap).toBeLessThan(0.31);
    }
    const html = compositionHtml(edit, "/media");
    expect(html.match(/<(video|audio) /g)).toHaveLength(6);
    expect(html).toContain("data-automation=");
  });

  it("the 10-take edit is 53.08 s at 25 fps with twenty media elements and take 1 cut from 208.05 s", () => {
    const edit = buildEdit("tentake");
    expect(edit.takes).toHaveLength(10);
    expect(edit.takes.reduce((a, t) => a + t.dur, 0)).toBeCloseTo(53.08, 2);
    expect(edit.takes[0]!.inPoint).toBeCloseTo(208.04, 1);
    expect(compositionHtml(edit, "/media").match(/<(video|audio) /g)).toHaveLength(20);
    expect(buildEdit("tentake")).toEqual(edit);
  });
});

describe("analyze", () => {
  const edit = buildEdit("primary");
  const base = (): Run => ({
    edit,
    comp: empty("comp"),
    host: empty("host"),
    playAt: 1000,
    endedAt: null,
    ownership: [],
  });

  it("counts the frames a visible outgoing video presents past its out-point, and ignores hidden ones", () => {
    const run = base();
    const out = edit.takes[0]!.outFrame;
    run.comp.frames = [
      [1100, "v0", (out - 1) / 30, 1, 1],
      [1133, "v0", out / 30, 2, 1],
      [1166, "v0", (out + 1) / 30, 3, 1],
      [1200, "v0", (out + 2) / 30, 4, 0],
    ];
    expect(analyze(run).firstTakeOverrunFrames).toBe(2);
  });

  it("measures the jump of a seek in the first 600 ms of a join and the second-frame gap of the incoming video", () => {
    const run = base();
    const t = edit.takes[1]!;
    // The playhead runs 1 s per second from the start; the audio window of take 1 opens at t.audio.start.
    for (let ms = 0; ms <= 4000; ms += 10)
      run.comp.samples.push([1000 + ms, "v0", 0, 0, 0, 1, 1, ms / 1000]);
    const open = 1000 + t.audio.start * 1000;
    // a1 plays, is seeked forward 80 ms at open + 200 ms
    for (let ms = 0; ms <= 600; ms += 10)
      run.comp.samples.push([
        open + ms,
        "a1",
        t.audio.mediaStart + ms / 1000 + (ms >= 200 ? 0.08 : 0),
        0,
        0,
        1,
        1,
        null,
      ]);
    run.comp.samples.sort((a, b) => a[0] - b[0]);
    run.comp.events = [
      [open + 5, "a1", "playing", 0],
      [open + 200, "a1", "seeking", 0],
    ];
    run.comp.frames = [
      [1000 + t.start * 1000, "v1", t.inPoint, 1, 1],
      [1000 + t.start * 1000 + 66.6, "v1", t.inPoint + 1 / 30, 2, 1],
    ];
    const m = analyze(run);
    expect(m.joinsWithMidPlaySeek).toBe(1);
    expect(m.jumpMaxMs).toBeGreaterThan(70);
    expect(m.jumpMaxMs).toBeLessThan(90);
    expect(m.secondFrameGapMedianMs).toBeCloseTo(66.6, 1);
  });

  it("reports a playhead that held 30 ms across a cut", () => {
    const run = base();
    const cut = edit.takes[1]!.start;
    let wall = 1000,
      ph = 0,
      held = false;
    for (let i = 0; i < 400; i++) {
      run.comp.samples.push([wall, "v0", 0, 0, 0, 1, 1, ph]);
      wall += 10;
      if (!held && ph >= cut) {
        wall += 30;
        held = true;
      }
      ph += 0.01;
    }
    expect(analyze(run).playheadHoldMedianMs).toBeCloseTo(30, 0);
  });

  it("reports an incoming picture that runs 50 ms behind the playhead after its cut", () => {
    const run = base();
    for (const t of edit.takes.slice(1))
      for (let i = 0; i <= 50; i++) {
        const ph = t.start + i * 0.01;
        run.comp.samples.push([
          1000 + ph * 1000,
          `v${t.index}`,
          t.inPoint + ph - t.start - 0.05,
          0,
          0,
          1,
          1,
          ph,
        ]);
      }
    const m = analyze(run);
    expect(m.cutPictureLagMedianMs).toBeCloseTo(50, 0);
    expect(m.cutPictureLagMaxMs).toBeCloseTo(50, 0);
  });

  it("counts a take as heard only when the audio reaching the output comes from that take's stretch of the file", () => {
    const run = base();
    run.ownership = [[1000, "parent"]];
    const t = edit.takes[1]!;
    expect(t.inPoint).toBeGreaterThan(5);
    // The playhead starts late and the host page has no __player, so its rows carry no playhead.
    const delay = Math.round(t.dur * 600);
    const open = 1000 + delay + t.start * 1000;
    for (let ms = 0; ms <= (t.start + t.dur) * 1000 + delay + 1000; ms += 10) {
      run.comp.samples.push([1000 + ms, "v0", 0, 0, 0, 1, 1, Math.max(0, ms - delay) / 1000]);
      run.host.samples.push([1000 + ms, "x", 0, 0, 0, 1, 1, null]);
    }
    const row = (at: number, pos: number): Dump["tap"][number] => [
      0,
      48000,
      0.1,
      0,
      Math.floor((pos % 16) / 0.5),
      Math.floor(pos / 16),
      at,
    ];
    // the previous take is still audible while the delayed playhead has not reached this take
    for (let ms = 0; ms < delay; ms += 100)
      run.host.tap.push(row(1000 + t.start * 1000 + ms, (t.inPoint + 25) % 50));
    for (let ms = 0; ms < t.dur * 1000; ms += 100)
      run.host.tap.push(row(open + ms, t.inPoint + ms / 1000));
    expect(analyze(run).takesHeard).toBe(1);
    // audio from another stretch of the file (the proxy playing from the wrong offset) is not heard
    run.host.tap = [];
    for (let ms = 0; ms < t.dur * 1000; ms += 100)
      run.host.tap.push(row(open + ms, (t.inPoint + 25 + ms / 1000) % 50));
    expect(analyze(run).takesHeard).toBe(0);
  });
});

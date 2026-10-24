import { describe, expect, it } from "vitest";
import {
  auditCraft,
  detectDeadStretches,
  detectFilmSilent,
  detectFirstFrameEmpty,
  detectLineUnread,
  detectTextBelowFloor,
  lineFloorSec,
  readingWords,
  typeFloorPx,
} from "./craftAudit.js";
import type { CraftFrame, CraftTextPart } from "./checkTypes.js";

const CANVAS = { width: 1920, height: 1080 };
const STEP = 0.125;

interface Shown {
  key: number;
  text: string;
  from: number;
  to: number;
  fontPx?: number;
  captions?: boolean;
  /** Block key; defaults to the element's own key. */
  block?: number;
}

function part(shown: Shown): CraftTextPart {
  const fontPx = shown.fontPx ?? 96;
  return {
    key: shown.key,
    block: shown.block ?? shown.key,
    selector: `#t${shown.key}`,
    blockSelector: `#t${shown.block ?? shown.key}`,
    sourceFile: "compositions/scene.html",
    text: shown.text,
    opacity: 1,
    fontPx,
    rect: { left: 100, top: 100 + shown.key * 10, width: 800, height: fontPx * 1.2 },
    captions: shown.captions ?? false,
  };
}

/** A frame at `time` showing every element whose [from, to) window holds it. */
function frameAt(
  time: number,
  shown: Shown[],
  extra: Partial<Omit<CraftFrame, "time" | "parts">> = {},
): CraftFrame {
  return {
    time,
    parts: shown.filter((entry) => time >= entry.from && time < entry.to).map(part),
    held: false,
    painted: true,
    signature: `moving-${time}`,
    ...extra,
  };
}

function grid(duration: number, step = STEP): number[] {
  const times: number[] = [];
  for (let time = 0; time < duration - 1e-9; time += step)
    times.push(Math.round(time * 1000) / 1000);
  return times;
}

function film(duration: number, shown: Shown[]): CraftFrame[] {
  return grid(duration).map((time) => frameAt(time, shown));
}

/** An exact probe: re-samples the same scene at any time, as a seek would. */
function probeFor(shown: Shown[]) {
  return async (time: number) => frameAt(time, shown);
}

describe("readingWords", () => {
  it("counts letter and number runs, and CJK by dictionary word", () => {
    expect(readingWords("Every team gets one shared calendar now")).toBe(7);
    expect(readingWords("42%")).toBe(1);
    expect(readingWords("✓ — →")).toBe(0);
    expect(readingWords("今天天气很好")).toBeGreaterThan(1);
  });
});

describe("lineFloorSec", () => {
  it("lets a 1–2 word line flash for 0.4 s and asks 3+ words for 3/4 of 0.5 s + 0.3 s a word", () => {
    expect(lineFloorSec(1, false)).toBe(0.4);
    expect(lineFloorSec(2, false)).toBe(0.4);
    expect(lineFloorSec(3, false)).toBeCloseTo(1.05);
    expect(lineFloorSec(6, false)).toBeCloseTo(1.725);
    expect(lineFloorSec(1, true)).toBe(2);
    expect(lineFloorSec(12, true)).toBeCloseTo(3.075);
  });
});

describe("line_unread", () => {
  it("warns on a 7-word line on screen 0.7 s, measured between grid samples", async () => {
    const shown: Shown[] = [
      { key: 1, text: "Every team gets one shared calendar now", from: 6.2, to: 6.9 },
      { key: 2, text: "Try it today", from: 13, to: 20 },
    ];
    const findings = await detectLineUnread(film(20, shown), 20, CANVAS, probeFor(shown));
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({ code: "line_unread", severity: "warning", words: 7 });
    expect(finding?.seconds).toBeCloseTo(0.7, 1);
    expect(finding?.floorSeconds).toBeCloseTo(1.95);
    expect(finding?.message).toContain("0.5 s + 0.3 s a word");
    expect(finding?.message).toContain("references/motion.md");
  });

  it("does not warn on a landed title held 1.5 s, a 0.4 s chapter word, captions or a 2.5 s end card", async () => {
    const shown: Shown[] = [
      { key: 1, text: "Ship it faster", from: 0.5, to: 2 },
      { key: 2, text: "Chapter", from: 3, to: 3.4 },
      { key: 3, text: "fast", from: 4, to: 4.3, captions: true },
      { key: 4, text: "caption words flash past", from: 4.3, to: 4.6, captions: true },
      { key: 5, text: "Try it today", from: 7.5, to: 10 },
    ];
    expect(await detectLineUnread(film(10, shown), 10, CANVAS, probeFor(shown))).toEqual([]);
  });

  it("holds the film's last line to 2 s even when it is one word", async () => {
    const shown: Shown[] = [
      { key: 1, text: "Ship it faster", from: 0, to: 5 },
      { key: 2, text: "HyperFrames", from: 9, to: 10 },
    ];
    const findings = await detectLineUnread(film(10, shown), 10, CANVAS, probeFor(shown));
    expect(findings.map((finding) => finding.selector)).toEqual(["#t2"]);
    expect(findings[0]?.floorSeconds).toBe(2);
    expect(findings[0]?.message).toContain("last line");
  });

  it("reads a headline split into inline word spans as one line", async () => {
    const words = ["Every", "team", "gets", "one", "shared", "calendar", "now"];
    const shown: Shown[] = words.map((text, index) => ({
      key: 10 + index,
      block: 1,
      text,
      from: 2,
      to: 2.6,
    }));
    shown.push({ key: 2, text: "End card here", from: 5, to: 8 });
    const findings = await detectLineUnread(film(8, shown), 8, CANVAS, probeFor(shown));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ selector: "#t1", words: 7 });
  });

  it("skips text too small to be a reading line", async () => {
    const shown: Shown[] = [
      { key: 1, text: "Legal fine print that flashes by", from: 1, to: 1.3, fontPx: 18 },
      { key: 2, text: "End card here", from: 4, to: 8 },
    ];
    expect(await detectLineUnread(film(8, shown), 8, CANVAS, probeFor(shown))).toEqual([]);
  });
});

describe("dead_stretch", () => {
  const still = (from: number, to: number) => (time: number) =>
    time >= from && time <= to ? "still" : `moving-${time}`;

  function framesWith(
    duration: number,
    signature: (time: number) => string,
    held: (time: number) => boolean = () => false,
  ) {
    return grid(duration).map((time) =>
      frameAt(time, [], { signature: signature(time), held: held(time) }),
    );
  }

  it("warns on 5 s of nothing changing mid-film", () => {
    const findings = detectDeadStretches(framesWith(20, still(7.5, 12.5)), 20);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "dead_stretch", time: 7.5, until: 12.5 });
    expect(findings[0]?.message).toContain("data-hold");
  });

  it("does not warn on a 1.5 s landed title or a 3 s still end card", () => {
    const signature = (time: number) =>
      (time >= 2 && time <= 3.5) || time >= 17 ? "still" : `moving-${time}`;
    expect(detectDeadStretches(framesWith(20, signature), 20)).toEqual([]);
  });

  it("leaves the final 3 s out of a long still ending", () => {
    expect(detectDeadStretches(framesWith(20, still(14, 20)), 20)).toEqual([]);
    const findings = detectDeadStretches(framesWith(20, still(12.5, 20)), 20);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.until).toBe(17);
  });

  it("does not count a stretch where a data-hold element is on screen", () => {
    const held = (time: number) => time >= 7 && time < 13;
    expect(detectDeadStretches(framesWith(20, still(7.5, 12.5), held), 20)).toEqual([]);
  });

  it("defers to sweep_static and keepsMoving when the pipeline says stillness is judged elsewhere", async () => {
    const result = await auditCraft({
      frames: framesWith(20, still(7.5, 12.5)),
      duration: 20,
      canvas: CANVAS,
      soundSources: 1,
      stillnessJudgedElsewhere: true,
    });
    expect(result.findings.map((finding) => finding.code)).not.toContain("dead_stretch");
  });
});

describe("text_below_floor", () => {
  it("puts the floor at 2.6% of the short side", () => {
    expect(typeFloorPx(CANVAS)).toBe(28);
    expect(typeFloorPx({ width: 1080, height: 1920 })).toBe(28);
    expect(typeFloorPx({ width: 3840, height: 2160 })).toBe(56);
  });

  it("warns once per file on small text held 0.5 s or more", () => {
    const shown: Shown[] = [
      { key: 1, text: "v2.4 release notes", from: 0.5, to: 6, fontPx: 18 },
      { key: 2, text: "Q1", from: 1, to: 6, fontPx: 14 },
    ];
    const findings = detectTextBelowFloor(film(10, shown), 10, CANVAS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "text_below_floor", fontPx: 14, floorPx: 28 });
    expect(findings[0]?.elements).toHaveLength(2);
    expect(findings[0]?.message).toContain("references/look.md");
  });

  it("does not warn on 28 px text, a brief small flash, captions or symbols", () => {
    const shown: Shown[] = [
      { key: 1, text: "Body copy at the floor", from: 0, to: 10, fontPx: 28 },
      { key: 2, text: "tiny flash", from: 2, to: 2.3, fontPx: 16 },
      { key: 3, text: "caption words", from: 0, to: 10, fontPx: 20, captions: true },
      { key: 4, text: "✓", from: 0, to: 10, fontPx: 8 },
    ];
    expect(detectTextBelowFloor(film(10, shown), 10, CANVAS)).toEqual([]);
  });
});

describe("first_frame_empty", () => {
  it("warns when frame 0 paints nothing but the background", () => {
    const findings = detectFirstFrameEmpty([
      frameAt(0, [], { painted: false }),
      frameAt(0.125, []),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("thumbnail");
    expect(findings[0]?.message).toContain("references/review.md");
  });

  it("does not warn when the title is already on screen at 0 s", () => {
    expect(detectFirstFrameEmpty([frameAt(0, [], { painted: true })])).toEqual([]);
    expect(detectFirstFrameEmpty([frameAt(0.5, [], { painted: false })])).toEqual([]);
  });
});

describe("film_silent", () => {
  it("warns on a film over 15 s with no sound source", () => {
    const [finding] = detectFilmSilent(20, 0);
    expect(finding?.code).toBe("film_silent");
    expect(finding?.message).toContain("unless the person asked for silence");
    expect(finding?.message).toContain("references/sound.md");
  });

  it("does not warn on a short film, a film with sound, or when sound was not inspected", () => {
    expect(detectFilmSilent(12, 0)).toEqual([]);
    expect(detectFilmSilent(20, 1)).toEqual([]);
    expect(detectFilmSilent(20, null)).toEqual([]);
  });
});

describe("auditCraft", () => {
  it("reports nothing on a well-made film", async () => {
    const shown: Shown[] = [
      { key: 1, text: "Ship faster with fewer meetings", from: 0, to: 5.8 },
      { key: 2, text: "42% fewer meetings", from: 6.3, to: 12.8 },
      { key: 3, text: "Try it today", from: 13.2, to: 20 },
    ];
    const signature = (time: number) =>
      (time >= 1 && time <= 2.5) || time >= 17 ? "still" : `moving-${time}`;
    const frames = grid(20).map((time) => frameAt(time, shown, { signature: signature(time) }));
    const result = await auditCraft(
      { frames, duration: 20, canvas: CANVAS, soundSources: 2, stillnessJudgedElsewhere: false },
      probeFor(shown),
    );
    expect(result).toMatchObject({ enabled: true, step: STEP, samples: 160, findings: [] });
  });
});

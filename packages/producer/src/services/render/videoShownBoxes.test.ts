import { describe, expect, it } from "vitest";
import type { VideoElement } from "@hyperframes/engine";
import type { Page } from "puppeteer-core";
import type { ProducerLogger } from "../../logger.js";
import { measureLocalShownBoxes, shownBoxTimes } from "./videoShownBoxes.js";

const video = (id: string, start: number, end: number): VideoElement => ({
  id,
  src: `${id}.mp4`,
  start,
  end,
  mediaStart: 0,
  loop: false,
  hasAudio: false,
});
const fps = { num: 30, den: 1 };

function logger() {
  const lines: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  const at =
    (level: string) =>
    (message: string, meta?: Record<string, unknown>): void => {
      lines.push({ level, message, meta });
    };
  const log: ProducerLogger = {
    error: at("error"),
    warn: at("warn"),
    info: at("info"),
    debug: at("debug"),
  };
  return { log, lines };
}

/** A page whose measure returns `ranges`, or rejects with `error`. */
function page(ranges: unknown, error?: Error): Page {
  let calls = 0;
  return {
    evaluate: async () => {
      calls += 1;
      if (calls > 1) return undefined; // the seek back to 0
      if (error) throw error;
      return ranges;
    },
  } as unknown as Page;
}

describe("shownBoxTimes", () => {
  it("samples each video from its first frame every 0.25 s to its last frame", () => {
    expect(shownBoxTimes([video("a", 1, 2)], fps, 10)).toEqual([1, 1.25, 1.5, 1.75, 2 - 1 / 30]);
  });

  it("merges the times of several videos once each, in order", () => {
    expect(shownBoxTimes([video("a", 0, 0.5), video("b", 0.25, 0.5)], fps, 10)).toEqual([
      0,
      0.25,
      0.5 - 1 / 30,
    ]);
  });

  it("cuts each window at the composition's end", () => {
    expect(shownBoxTimes([video("a", 0.5, Number.POSITIVE_INFINITY)], fps, 1)).toEqual([
      0.5,
      0.75,
      1 - 1 / 30,
    ]);
    expect(shownBoxTimes([video("a", 0, 1e12)], fps, 0.5)).toEqual([0, 0.25, 0.5 - 1 / 30]);
  });

  it("returns promptly for a start too large for the stride to advance", () => {
    expect(shownBoxTimes([video("a", 2 ** 53, 2 ** 54)], fps, 10)).toEqual([]);
    expect(shownBoxTimes([video("a", Number.NaN, 1)], fps, 10)).toEqual([]);
  });

  it("puts every video's strides on one grid, so many offset videos add only their own first and last frames", () => {
    const offset = Array.from({ length: 1000 }, (_, i) => video(`v${i}`, i / 1000, 10));
    expect(shownBoxTimes(offset, fps, 10).length).toBeLessThanOrEqual(10 / 0.25 + 2 * 1000);
  });
});

describe("measureLocalShownBoxes", () => {
  it("keeps a static box exact and adds 10% to a box that changes", async () => {
    const { log, lines } = logger();
    const boxes = await measureLocalShownBoxes(
      page([
        [
          "still",
          { largest: { width: 1920, height: 1080 }, smallest: { width: 1920, height: 1080 } },
        ],
        ["zoom", { largest: { width: 400, height: 200 }, smallest: { width: 100, height: 50 } }],
      ]),
      [video("still", 0, 1), video("zoom", 0, 1)],
      fps,
      1,
      log,
    );
    expect(Object.fromEntries(boxes!)).toEqual({
      still: { width: 1920, height: 1080 },
      zoom: { width: expect.closeTo(440, 6), height: expect.closeTo(220, 6) },
    });
    expect(lines.find((l) => l.level === "info")?.meta).toMatchObject({
      videos: 2,
      boxed: 2,
      seeks: 5,
    });
  });

  it("returns no boxes, so every video keeps its full size, when the measure fails", async () => {
    const { log, lines } = logger();
    const boxes = await measureLocalShownBoxes(
      page(undefined, new Error("Target closed")),
      [video("clip", 0, 1)],
      fps,
      1,
      log,
    );
    expect(boxes).toBeUndefined();
    expect(lines.find((l) => l.level === "warn")?.meta).toMatchObject({ error: "Target closed" });
  });
});

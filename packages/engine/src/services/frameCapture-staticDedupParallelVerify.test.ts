import { describe, expect, it } from "vitest";
import {
  planStaticVerification,
  verifyStaticFramesSafe,
  type CaptureSession,
} from "./frameCapture.js";

const fps = 30;
type FakePage = { frame: number; evaluate: (fn: unknown, time: number) => Promise<void> };

function fakePage(): FakePage {
  const page: FakePage = {
    frame: 0,
    evaluate: async (_fn, time) => {
      page.frame = Math.round(time * fps);
    },
  };
  return page;
}

function framesForRuns(runs: Array<[number, number]>): Set<number> {
  const frames = new Set<number>();
  for (const [a, b] of runs) for (let f = a; f <= b; f++) frames.add(f);
  return frames;
}

/** Screenshots of a page show `contentAt(frame)`; `inFlight.max` records how many ran at once. */
function capturing(contentAt: (frame: number) => string) {
  const inFlight = { now: 0, max: 0 };
  const capture = async (target: unknown) => {
    inFlight.now++;
    inFlight.max = Math.max(inFlight.max, inFlight.now);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight.now--;
    return Buffer.from(contentAt((target as FakePage).frame));
  };
  return { capture, inFlight };
}

function verify(
  pages: FakePage[],
  frames: Set<number>,
  capture: (target: unknown) => Promise<Buffer>,
  now?: () => number,
) {
  return verifyStaticFramesSafe(
    { options: {} } as unknown as CaptureSession,
    pages as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
    frames,
    fps,
    1,
    { capture: capture as never, ...(now ? { now } : {}) },
  );
}

const runs: Array<[number, number]> = [
  [1, 40],
  [50, 90],
  [100, 140],
  [150, 190],
];

describe("verifyStaticFramesSafe on several pages", () => {
  it("verifies runs on every page at once", async () => {
    const { capture, inFlight } = capturing(() => "still");

    const result = await verify([fakePage(), fakePage()], framesForRuns(runs), capture);

    expect(result.outcome).toBe("verified");
    expect(result.verifiedFrames).toEqual(framesForRuns(runs));
    expect(inFlight.max).toBe(2);
  });

  it("a mismatch on one page clears the runs another page verified", async () => {
    const { capture } = capturing((frame) => (frame >= 150 ? "moved" : "still"));

    const result = await verify([fakePage(), fakePage()], framesForRuns(runs), capture);

    expect(result.outcome).toBe("mismatch");
    expect(result.verifiedFrames.size).toBe(0);
  });

  it("gives the verdict one page gives", async () => {
    const one = await verify([fakePage()], framesForRuns(runs), capturing(() => "still").capture);
    const three = await verify(
      [fakePage(), fakePage(), fakePage()],
      framesForRuns(runs),
      capturing(() => "still").capture,
    );

    expect(three.outcome).toBe(one.outcome);
    expect(three.verifiedFrames).toEqual(one.verifiedFrames);
    expect(three.stats.completedRuns).toBe(one.stats.completedRuns);
  });

  it("scales its time budget from the first shot when pages capture together", async () => {
    const frames = framesForRuns(runs);
    const shotMs = Math.ceil(20_000 / planStaticVerification(frames, 1).plannedScreenshots);
    let clock = 0;
    const { capture } = capturing(() => "still");
    const slowCapture = async (target: unknown) => {
      clock += shotMs;
      return capture(target);
    };

    const result = await verify([fakePage(), fakePage()], frames, slowCapture, () => clock);

    expect(result.outcome).toBe("verified");
    expect(result.verifiedFrames).toEqual(frames);
  });
});

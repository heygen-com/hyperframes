import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import {
  MAX_RISK_FRAME_FRACTION,
  RISK_RANGE_HYSTERESIS_FRAMES,
  planRiskFrames,
  riskSessionFits,
  RISK_RENDER_HEADROOM_BYTES,
  RISK_RENDER_ADDED_BYTES,
  withFramesAfterCallback,
  scanCssEffectLiveFrames,
} from "./riskFrames.js";

describe("planRiskFrames", () => {
  it("adds a one-frame margin around each range", () => {
    expect([...(planRiskFrames([50, 51], 1000) ?? [])]).toEqual([49, 50, 51, 52]);
  });

  it("clamps the margin to the render", () => {
    expect([...(planRiskFrames([0, 99], 100) ?? [])].sort((a, b) => a - b)).toEqual(
      expect.arrayContaining([0, 1, 98, 99]),
    );
  });

  it("joins ranges closer than the hysteresis so capture never alternates modes", () => {
    const gap = RISK_RANGE_HYSTERESIS_FRAMES;
    const plan = planRiskFrames([100, 100 + gap], 10_000);
    expect(plan?.has(100 + Math.floor(gap / 2))).toBe(true);
  });

  it("keeps ranges farther apart than the hysteresis separate", () => {
    const gap = RISK_RANGE_HYSTERESIS_FRAMES + 1;
    const plan = planRiskFrames([100, 100 + gap], 10_000);
    expect(plan?.has(100 + Math.floor(gap / 2))).toBe(false);
  });

  it("gives no plan when risk frames cover most of the render", () => {
    const frames = Array.from(
      { length: Math.ceil(100 * MAX_RISK_FRAME_FRACTION) + 1 },
      (_, i) => i,
    );
    expect(planRiskFrames(frames, 100)).toBeNull();
  });

  it("plans nothing for no risk frames", () => {
    expect(planRiskFrames([], 100)?.size).toBe(0);
  });
});

const GLOBALS = ["document", "window", "getComputedStyle"] as const;
const saved = new Map<string, unknown>();

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [k, v] of saved) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
  saved.clear();
});

type Style = { visibility: string; display: string; opacity: string };
const SHOWN: Style = { visibility: "visible", display: "block", opacity: "1" };

/** A page whose one effect element is styled by `styleOf(seconds)`, with optional children. */
function makePage(styleOf: (t: number) => Style, children: Array<(t: number) => Style> = []): Page {
  let now = 0;
  const kids = children.map(() => ({ parentElement: null as unknown }));
  const el = {
    parentElement: { parentElement: null },
    querySelectorAll: () => kids,
  };
  kids.forEach((k) => (k.parentElement = el));
  const win = {
    __hfCssFxTargets: [el],
    __hf: {
      seek: (t: number) => {
        now = t;
      },
    },
  };
  const computed = (n: unknown) => {
    if (n === el) return styleOf(now);
    const i = kids.indexOf(n as (typeof kids)[number]);
    return i >= 0 ? (children[i] as (t: number) => Style)(now) : SHOWN;
  };
  return {
    evaluate: async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => {
      const g = globalThis as Record<string, unknown>;
      for (const k of GLOBALS) if (!saved.has(k)) saved.set(k, g[k]);
      g.window = win;
      g.document = {};
      g.getComputedStyle = computed;
      return fn(...args);
    },
  } as unknown as Page;
}

const between = (from: number, to: number) => (t: number) =>
  t >= from && t < to ? SHOWN : { ...SHOWN, visibility: "hidden" };
const frames = (live: Set<number> | null) => [...(live ?? [])].sort((a, b) => a - b);
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe("scanCssEffectLiveFrames", () => {
  it("stops after one chunk when the whole scan would hold back the first frame too long", async () => {
    const seeks: number[] = [];
    const page = makePage(between(0, 0));
    const evaluate = page.evaluate.bind(page);
    page.evaluate = (async (...args: Parameters<Page["evaluate"]>) => {
      seeks.push((args[1] as number[]).length);
      return evaluate(...args);
    }) as Page["evaluate"];
    let clock = 0;
    // 24 ms a frame, what a heavy page costs: 40,219 frames would take 16 minutes.
    const now = () => (clock += 240 * 24);

    expect(
      await scanCssEffectLiveFrames(page, 60, 40_219, 40_219, { budgetMs: 60_000, now }),
    ).toBeNull();
    expect(seeks).toEqual([240]);
  });

  it("reports the frames scanned after each chunk", async () => {
    const seen: Array<[number, number]> = [];

    await scanCssEffectLiveFrames(makePage(between(0, 0)), 10, 500, 500, {
      onProgress: (scanned, total) => seen.push([scanned, total]),
    });
    expect(seen).toEqual([
      [240, 500],
      [480, 500],
      [500, 500],
    ]);
  });

  it("scans to the end when the whole scan fits the budget", async () => {
    let clock = 0;
    const now = () => (clock += 240);

    const live = await scanCssEffectLiveFrames(
      makePage(between(2, 4)),
      10,
      1000,
      1000,
      60_000,
      now,
    );
    expect(frames(live)).toEqual(range(20, 20));
  });

  it("returns the frames where the effect element shows", async () => {
    const live = await scanCssEffectLiveFrames(makePage(between(2, 4)), 10, 100, 100);
    expect(frames(live)).toEqual(range(20, 20));
  });

  it("does not count a fully transparent element", async () => {
    const live = await scanCssEffectLiveFrames(
      makePage((t) => ({ ...SHOWN, opacity: t < 3 ? "0" : "1" })),
      10,
      50,
      50,
    );
    expect(frames(live)).toEqual(range(30, 20));
  });

  it("counts a hidden element while a descendant sets visibility: visible", async () => {
    const live = await scanCssEffectLiveFrames(
      makePage(between(0, 0), [between(1, 2)]),
      10,
      50,
      50,
    );
    expect(frames(live)).toEqual(range(10, 10));
  });

  it("gives up once more frames qualify than the cap", async () => {
    expect(await scanCssEffectLiveFrames(makePage(between(0, 100)), 10, 100, 10)).toBeNull();
  });
});

describe("withFramesAfterCallback", () => {
  it("adds every frame from just before the first callback to the end", () => {
    const live = withFramesAfterCallback(new Set([3]), 2, 10, 30);
    expect([...live].sort((a, b) => a - b)).toEqual([3, ...range(19, 11)]);
  });

  it("changes nothing without a callback", () => {
    expect([...withFramesAfterCallback(new Set([3]), null, 10, 30)]).toEqual([3]);
  });
});

describe("riskSessionFits", () => {
  const mb = (bytes: number) => Math.ceil(bytes / 1024 / 1024);
  const HD = 1920 * 1080;

  it("needs what the render adds plus the headroom", () => {
    const need = mb(RISK_RENDER_ADDED_BYTES + RISK_RENDER_HEADROOM_BYTES);
    expect(riskSessionFits(need, HD)).toBe(true);
    expect(riskSessionFits(need - 10, HD)).toBe(false);
  });

  it("asks for four times as much at 4K, which holds four times the pixels", () => {
    const need = mb(RISK_RENDER_ADDED_BYTES + RISK_RENDER_HEADROOM_BYTES);
    expect(riskSessionFits(need, HD * 4)).toBe(false);
    expect(
      riskSessionFits(mb(4 * RISK_RENDER_ADDED_BYTES + RISK_RENDER_HEADROOM_BYTES), HD * 4),
    ).toBe(true);
  });
});

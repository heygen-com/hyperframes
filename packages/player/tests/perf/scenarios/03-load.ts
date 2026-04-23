/**
 * Scenario 03: composition load (cold + warm).
 *
 * Cold: a fresh BrowserContext per run so the network cache is empty. Measures
 * the wall-clock time from `page.goto` until the player fires its `ready`
 * event (host shell sets `window.__playerReady`). This stresses html parse +
 * runtime IIFE eval + GSAP eval + the player's first composition init.
 *
 * Warm: same BrowserContext is reused across runs so the static assets
 * (player bundle, runtime, GSAP, fixture HTML) are served from disk cache.
 * This isolates the player's per-composition init cost from network I/O.
 *
 * Both metrics report p95 over `runs` samples and feed into perf-gate.ts:
 *   - compLoadColdP95Ms (lower is better)
 *   - compLoadWarmP95Ms (lower is better)
 */

import type { Browser } from "puppeteer-core";
import { loadHostPage, percentile } from "../runner.ts";
import type { Metric } from "../perf-gate.ts";

export type LoadScenarioOpts = {
  browser: Browser;
  origin: string;
  /** Number of cold and warm runs each. */
  runs: number;
  /** If null, runs the default fixture (gsap-heavy). */
  fixture: string | null;
};

const DEFAULT_FIXTURE = "gsap-heavy";

export async function runLoad(opts: LoadScenarioOpts): Promise<Metric[]> {
  const fixture = opts.fixture ?? DEFAULT_FIXTURE;
  const runs = Math.max(1, opts.runs);
  console.log(`[scenario:load] fixture=${fixture} runs=${runs}`);

  const cold: number[] = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await opts.browser.createBrowserContext();
    try {
      const page = await ctx.newPage();
      const { loadMs, duration } = await loadHostPage(page, opts.origin, { fixture });
      cold.push(loadMs);
      console.log(
        `[scenario:load] cold[${i + 1}/${runs}] loadMs=${loadMs.toFixed(1)} duration=${duration}s`,
      );
      await page.close();
    } finally {
      await ctx.close();
    }
  }

  const warm: number[] = [];
  const warmCtx = await opts.browser.createBrowserContext();
  try {
    const warmupPage = await warmCtx.newPage();
    await loadHostPage(warmupPage, opts.origin, { fixture });
    await warmupPage.close();

    for (let i = 0; i < runs; i++) {
      const page = await warmCtx.newPage();
      const { loadMs, duration } = await loadHostPage(page, opts.origin, { fixture });
      warm.push(loadMs);
      console.log(
        `[scenario:load] warm[${i + 1}/${runs}] loadMs=${loadMs.toFixed(1)} duration=${duration}s`,
      );
      await page.close();
    }
  } finally {
    await warmCtx.close();
  }

  const coldP95 = percentile(cold, 95);
  const warmP95 = percentile(warm, 95);
  console.log(
    `[scenario:load] cold p95=${coldP95.toFixed(1)}ms (samples=${cold.length}) warm p95=${warmP95.toFixed(1)}ms (samples=${warm.length})`,
  );

  return [
    {
      name: "comp_load_cold_p95_ms",
      baselineKey: "compLoadColdP95Ms",
      value: coldP95,
      unit: "ms",
      direction: "lower-is-better",
      samples: cold,
    },
    {
      name: "comp_load_warm_p95_ms",
      baselineKey: "compLoadWarmP95Ms",
      value: warmP95,
      unit: "ms",
      direction: "lower-is-better",
      samples: warm,
    },
  ];
}

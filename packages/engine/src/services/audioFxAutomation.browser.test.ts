import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { scheduleParamLane } from "../../../core/src/audio/audioFxAutomation.js";
import { sampleAutomationCurve, type HfAutomationLane } from "../../../core/src/audioAutomation.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";

declare global {
  interface Window {
    hfScheduleParamLane: typeof scheduleParamLane;
  }
}

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

const lane: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 0, v: 0.1, curve: 0.7 },
    { t: 0.004, v: 0.3, curve: 0.7 },
    { t: 0.008, v: 0.5, curve: 0.7 },
    { t: 0.012, v: 0.7 },
  ],
};
// The last bend as the scheduler books it: 8 sampled points (its minimum for 4 ms), ramped between.
const bend = sampleAutomationCurve(lane, 0.008, 0.012, 8, "linear");
const expectedAt = (laneTime: number): number => {
  if (laneTime >= 0.012) return 0.7;
  const k = ((laneTime - 0.008) / 0.004) * (bend.length - 1);
  const i = Math.floor(k);
  return bend[i]! + (bend[i + 1]! - bend[i]!) * (k - i);
};

describe.skipIf(!hasBrowser)("clamped audio automation in WebAudio", () => {
  let browser: Browser;
  let scheduler: string;

  beforeAll(async () => {
    const entry = fileURLToPath(
      new URL("../../../core/src/audio/audioFxAutomation.ts", import.meta.url),
    );
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import { scheduleParamLane } from ${JSON.stringify(entry)}; globalThis.hfScheduleParamLane = scheduleParamLane;`,
      },
      bundle: true,
      format: "iife",
      write: false,
    });
    scheduler = bundled.outputFiles[0]!.text;
    browser = await launchTestChrome(chromePath);
  });
  afterAll(() => closeTestChrome(browser));

  it.each([0, 0.024])("renders the envelope, bend kept, at scheduledAt=%s", async (scheduledAt) => {
    const page = await browser.newPage();
    try {
      await page.addScriptTag({ content: scheduler });
      const samples = await page.evaluate(
        async (at, laneArg) => {
          const ctx = new OfflineAudioContext(1, 8192, 48000);
          const gain = ctx.createGain();
          const source = ctx.createConstantSource();
          source.connect(gain).connect(ctx.destination);
          source.start();
          const suspended = ctx.suspend(0.032);
          const rendering = ctx.startRendering();
          await suspended;
          const firstFrame = Math.round(ctx.currentTime * ctx.sampleRate);
          window.hfScheduleParamLane([{ param: gain.gain }], laneArg, "linear", {
            scheduledAt: at,
            elapsed: 0,
            rate: 1,
          });
          await ctx.resume();
          const output = (await rendering).getChannelData(0);
          return { firstFrame, values: Array.from(output.slice(firstFrame)) };
        },
        scheduledAt,
        lane,
      );
      expect(samples.values.length).toBeGreaterThan(192);
      const errors = samples.values.map((value, index) => {
        const laneTime = (samples.firstFrame + index) / 48000 - scheduledAt;
        return Math.abs(value - expectedAt(laneTime));
      });
      expect(Math.max(...errors)).toBeLessThan(0.000001);
    } finally {
      await page.close();
    }
  });
});

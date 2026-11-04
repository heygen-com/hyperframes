import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { scheduleParamLane } from "../../../core/src/audio/audioFxAutomation.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";

declare global {
  interface Window {
    hfScheduleParamLane: typeof scheduleParamLane;
  }
}

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

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

  it.each([0, 0.024])("renders the recovered envelope at scheduledAt=%s", async (scheduledAt) => {
    const page = await browser.newPage();
    try {
      await page.addScriptTag({ content: scheduler });
      const samples = await page.evaluate(async (at) => {
        const ctx = new OfflineAudioContext(1, 8192, 48000);
        const gain = ctx.createGain();
        const source = ctx.createConstantSource();
        source.connect(gain).connect(ctx.destination);
        source.start();
        const suspended = ctx.suspend(0.032);
        const rendering = ctx.startRendering();
        await suspended;
        const firstFrame = Math.round(ctx.currentTime * ctx.sampleRate);
        window.hfScheduleParamLane(
          [{ param: gain.gain }],
          {
            target: "volume",
            points: [
              { t: 0, v: 0.1, curve: 0.7 },
              { t: 0.004, v: 0.3, curve: 0.7 },
              { t: 0.008, v: 0.5, curve: 0.7 },
              { t: 0.012, v: 0.7 },
            ],
          },
          "linear",
          { scheduledAt: at, elapsed: 0, rate: 1 },
        );
        await ctx.resume();
        const output = (await rendering).getChannelData(0);
        return { firstFrame, values: Array.from(output.slice(firstFrame)) };
      }, scheduledAt);
      expect(samples.values.length).toBeGreaterThan(192);
      const errors = samples.values.map((value, index) => {
        const laneTime = (samples.firstFrame + index) / 48000 - scheduledAt;
        const expected = Math.min(0.7, 0.5 + ((laneTime - 0.008) / 0.004) * 0.2);
        return Math.abs(value - expected);
      });
      expect(Math.max(...errors)).toBeLessThan(0.000001);
    } finally {
      await page.close();
    }
  });
});

import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import {
  captureFrame,
  hasBrowser,
  launch,
  openFixture,
  type BlurWindow,
} from "./__fixtures__/motionBlur/blurPage.js";
import { FIXTURES, ROTATING_CARD } from "./__fixtures__/motionBlur/fixtures.js";
import type { Rgba } from "./__fixtures__/blurDifferential.js";

// A fixture with no `moving` times still slides its card in at 0.2 s: that is where blur on and blur off must differ.
const PROBE_WHILE_CARD_SLIDES = 6 / 30;
const CASE_TIMEOUT_MS = 30_000;

describe.skipIf(!hasBrowser)("capture motion blur fixtures in Chrome", () => {
  let browser: Browser;
  let supported = false;

  beforeAll(async () => {
    ({ browser, supported } = await launch());
  }, 30_000);
  afterAll(() => closeTestChrome(browser));

  it("covers every failure class with a distinct fixture", () => {
    expect(new Set(FIXTURES.map((f) => f.name)).size).toBe(FIXTURES.length);
    expect(FIXTURES.length).toBeGreaterThanOrEqual(13);
  });

  it.each(FIXTURES)(
    "renders $name with blur off and on without page errors, and the on report matches expectOn",
    async (fixture, ctx) => {
      if (!supported) ctx.skip();
      const size = { width: fixture.width, height: fixture.height };
      const first = fixture.checkpoints[0] ?? 0;
      const moving = fixture.moving[0] ?? PROBE_WHILE_CARD_SLIDES;
      const errors: string[] = [];
      const watch = (page: Awaited<ReturnType<typeof openFixture>>): void => {
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
      };

      let sharpMoving: Rgba | undefined;
      const off = await openFixture(browser, fixture.html("off"), fixture.dpr, size);
      watch(off);
      try {
        sharpMoving = await captureFrame(off, moving);
        const frame = await captureFrame(off, first);
        expect(frame.width).toBe(fixture.width * fixture.dpr);
        expect(frame.height).toBe(fixture.height * fixture.dpr);
        const report = await off.evaluate(
          () => (window as BlurWindow).__hfMotionBlur?.report() ?? null,
        );
        if (report) expect(report.state).toBe("off");
      } finally {
        await off.close();
      }

      const on = await openFixture(browser, fixture.html("on"), fixture.dpr, size);
      watch(on);
      try {
        const blurredMoving = await captureFrame(on, moving);
        await captureFrame(on, first);
        const report = await on.evaluate(() => (window as BlurWindow).__hfMotionBlur?.probe());
        expect(errors).toEqual([]);
        const { minMovers, ...expected } = fixture.expectOn;
        expect(report).toMatchObject({ ...expected, failedFrames: 0 });
        if (expected.state === "on") {
          expect(report?.movers ?? 0).toBeGreaterThanOrEqual(minMovers ?? 1);
        }
        const differs = !Buffer.from(blurredMoving.data).equals(Buffer.from(sharpMoving.data));
        expect(differs).toBe(true);
      } finally {
        await on.close();
      }
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "auto draws a rotating mover with the filter tier and a page that asks for capture keeps it",
    async (ctx) => {
      if (!supported) ctx.skip();
      const f = ROTATING_CARD;
      const size = { width: f.width, height: f.height };
      const probeOn = async (tier?: "capture" | "filter") => {
        const page = await openFixture(browser, f.html("on", tier), f.dpr, size);
        try {
          await captureFrame(page, PROBE_WHILE_CARD_SLIDES);
          return await page.evaluate(() => (window as BlurWindow).__hfMotionBlur?.probe());
        } finally {
          await page.close();
        }
      };
      const auto = await probeOn();
      expect(auto).toMatchObject({
        state: "on",
        tier: "filter",
        reasonCode: "tier-auto",
        failedFrames: 0,
      });
      expect(auto?.movers).toBeGreaterThanOrEqual(1);
      expect(await probeOn("capture")).toMatchObject({
        state: "on",
        tier: "capture",
        reasonCode: null,
        failedFrames: 0,
      });
    },
    CASE_TIMEOUT_MS,
  );

  it.each(FIXTURES)("places the checkpoints of $name inside its holds on frame boundaries", (f) => {
    const onFrame = (t: number): boolean => Math.abs(t * 30 - Math.round(t * 30)) < 1e-9;
    expect(f.checkpoints.length).toBeGreaterThan(0);
    for (const t of [...f.checkpoints, ...f.moving]) {
      expect(onFrame(t)).toBe(true);
      expect(t).toBeLessThanOrEqual(f.durationSeconds);
    }
    for (const c of f.checkpoints) {
      for (const m of f.moving) expect(Math.round(Math.abs(c - m) * 30)).toBeGreaterThanOrEqual(3);
    }
  });
});

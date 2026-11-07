import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser, Frame, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceleratedCanvasTrackerSource } from "@hyperframes/core";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { RUNTIME, hasBrowser, launch } from "./__fixtures__/motionBlur/blurPage.js";
import { FIXTURES, type BlurFixture } from "./__fixtures__/motionBlur/fixtures.js";
import {
  advancedOf,
  distinctOf,
  newFramesIn,
  slideOutWatched,
  type Shot,
} from "./__fixtures__/motionBlur/slideOutWatch.js";

const MIN_CLOCK_ADVANCE_S = 0.3;
const MIN_DISTINCT_FRAMES = 3;
const LIVENESS_DEADLINE_MS = 3_000;
// held-card holds from 0.4 s to 1.6 s and slides out until 2.0 s: a freeze anywhere in the hold shows as a slide-out that never draws.
const SLIDE_OUT_FIXTURE = "held-card";
const SLIDE_OUT = { startS: 1.6, endS: 2 };
const SLIDE_OUT_DEADLINE_MS = 5_000;
const WRAP_DEADLINE_MS = 3_000;
const CASE_TIMEOUT_MS = 30_000;

type PlayerWindow = Window & {
  __playerReady?: boolean;
  __player?: { play: () => void; pause: () => void; getTime: () => number };
};

interface BlankCensus {
  wrapped: number;
  blank: number;
  /** Wrapped callbacks whose output canvas has no 2d context, which the detector cannot read. */
  unreadable: number;
}

const playable = FIXTURES.filter((f) => f.expectOn.state === "on");
const captureTier = FIXTURES.filter(
  (f) => f.expectOn.state === "on" && f.expectOn.tier === "capture",
);

/**
 * The preview as Studio builds it: the tracker in the host window, the composition in an iframe
 * the host's MutationObserver already watches, the runtime booted inside it. No render-mode seek
 * config, so the runtime takes its playing path.
 */
async function openPreview(
  browser: Browser,
  fixture: BlurFixture,
): Promise<{ page: Page; preview: Frame }> {
  const page = await browser.newPage();
  await page.setViewport({
    width: fixture.width,
    height: fixture.height,
    deviceScaleFactor: fixture.dpr,
  });
  await page.setContent(
    `<style>html,body{margin:0}iframe{display:block;border:0}</style><script>${acceleratedCanvasTrackerSource()}</script><iframe id="preview" width="${fixture.width}" height="${fixture.height}"></iframe>`,
  );
  await page.$eval(
    "#preview",
    (el, html) =>
      new Promise((done) => {
        const frame = el as HTMLIFrameElement;
        frame.onload = done;
        frame.srcdoc = html;
      }),
    fixture.html("on"),
  );
  await page.evaluate(() => {
    const frame = document.getElementById("preview") as HTMLIFrameElement;
    new MutationObserver(() => {}).observe(
      frame.contentDocument?.getElementById("root") as Element,
      {
        childList: true,
      },
    );
  });
  const preview = page.frames().find((f) => f !== page.mainFrame());
  if (!preview) throw new Error("no preview frame");
  await preview.addScriptTag({ content: readFileSync(RUNTIME, "utf8") });
  await preview.waitForFunction(() => (window as PlayerWindow).__playerReady === true);
  return { page, preview };
}

const clockOf = (preview: Frame): Promise<number> =>
  preview.evaluate(() => (window as PlayerWindow).__player?.getTime() ?? -1);

async function startPlaying(preview: Frame): Promise<void> {
  await preview.evaluate(() => (window as PlayerWindow).__player?.play());
}

async function stopPlaying(preview: Frame): Promise<void> {
  await preview.evaluate(() => (window as PlayerWindow).__player?.pause());
}

const hashOf = (png: Uint8Array): string => createHash("md5").update(png).digest("hex");

/** Screenshots of the preview while it plays, until `enough` says the clock and the pixels have moved or time runs out. */
async function watchPreview(
  page: Page,
  preview: Frame,
  fixture: BlurFixture,
  enough: (shots: readonly Shot[]) => boolean,
  deadlineMs: number,
): Promise<Shot[]> {
  const clip = { x: 0, y: 0, width: fixture.width, height: fixture.height };
  const shots: Shot[] = [];
  const clock0 = await clockOf(preview);
  let clockAfter = clock0;
  const deadline = Date.now() + deadlineMs;
  await startPlaying(preview);
  while (Date.now() < deadline && !enough(shots)) {
    const clockBefore = clockAfter;
    const hash = hashOf(await page.screenshot({ type: "png", clip }));
    clockAfter = await clockOf(preview);
    shots.push({ hash, clockBefore: clockBefore - clock0, clockAfter: clockAfter - clock0 });
  }
  return shots;
}

const movedEnough = (shots: readonly Shot[]): boolean =>
  advancedOf(shots) >= MIN_CLOCK_ADVANCE_S && distinctOf(shots) >= MIN_DISTINCT_FRAMES;

async function checkKeepsChanging(browser: Browser, fixture: BlurFixture): Promise<void> {
  const { page, preview } = await openPreview(browser, fixture);
  try {
    const wholeFilm = fixture.name === SLIDE_OUT_FIXTURE;
    const shots = await watchPreview(
      page,
      preview,
      fixture,
      wholeFilm ? (s) => slideOutWatched(s, SLIDE_OUT) : movedEnough,
      wholeFilm ? SLIDE_OUT_DEADLINE_MS : LIVENESS_DEADLINE_MS,
    );
    const advanced = advancedOf(shots);
    const distinct = distinctOf(shots);
    expect(
      advanced,
      `the preview never played: ${fixture.name}'s clock moved ${advanced.toFixed(3)} s`,
    ).toBeGreaterThanOrEqual(wholeFilm ? SLIDE_OUT.startS : MIN_CLOCK_ADVANCE_S);
    expect(
      distinct,
      `the preview froze: ${fixture.name}'s clock advanced ${advanced.toFixed(3)} s but the pixels showed ${distinct} distinct frames`,
    ).toBeGreaterThanOrEqual(MIN_DISTINCT_FRAMES);
    if (wholeFilm) {
      expect(
        newFramesIn(shots, SLIDE_OUT),
        `the preview froze mid-film: ${fixture.name} drew nothing new after ${SLIDE_OUT.startS} s (${distinct} distinct frames in ${advanced.toFixed(3)} s)`,
      ).toBeGreaterThan(0);
    }
  } finally {
    await page.close();
  }
}

/**
 * Plays until the root is wrapped and reads the output canvas the moment the wrap lands. A MutationObserver
 * runs when the wrap's own task ends, so the read cannot fall between two polls. The wrap clears the output and
 * moves the root into the capture canvas, which the page does not render; the first draw needs a later paint.
 * An output with no ink at that moment is what the next presented frame shows. How many frames reach the
 * screen before the first draw depends on where the wrap falls between two vsyncs (zero or one here), so that
 * count is not asserted.
 */
async function censusOfBlankFrames(browser: Browser, fixture: BlurFixture): Promise<BlankCensus> {
  const { page, preview } = await openPreview(browser, fixture);
  try {
    return await preview.evaluate(
      (deadlineMs) =>
        new Promise<BlankCensus>((done) => {
          const census = { wrapped: 0, blank: 0, unreadable: 0 };
          const root = document.getElementById("root") as HTMLElement;
          const hasInk = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean => {
            for (let i = 0; i < 8; i++)
              for (let j = 0; j < 8; j++) {
                const x = Math.floor(((i + 0.5) / 8) * canvas.width);
                const y = Math.floor(((j + 0.5) / 8) * canvas.height);
                if ((ctx.getImageData(x, y, 1, 1).data[3] ?? 0) > 0) return true;
              }
            return false;
          };
          const observer = new MutationObserver(() => {
            if (root.parentElement?.getAttribute("data-hf-motion-blur") !== "capture") return;
            observer.disconnect();
            census.wrapped++;
            const out = document.querySelector<HTMLCanvasElement>(
              'canvas[data-hf-motion-blur="output"]',
            );
            const ctx = out?.getContext("2d");
            if (!out || !ctx) census.unreadable++;
            else if (!hasInk(ctx, out)) census.blank++;
            done(census);
          });
          observer.observe(document, { subtree: true, childList: true });
          setTimeout(() => {
            observer.disconnect();
            done(census);
          }, deadlineMs);
          (window as PlayerWindow).__player?.play();
        }),
      WRAP_DEADLINE_MS,
    );
  } finally {
    await stopPlaying(preview).catch(() => {});
    await page.close();
  }
}

async function censusOfAll(browser: Browser): Promise<{ name: string; census: BlankCensus }[]> {
  const rows: { name: string; census: BlankCensus }[] = [];
  for (const fixture of captureTier)
    rows.push({ name: fixture.name, census: await censusOfBlankFrames(browser, fixture) });
  return rows;
}

const describeRow = ({ name, census }: { name: string; census: BlankCensus }): string =>
  `${name}: ${census.wrapped} wrapped, ${census.blank} blank, ${census.unreadable} unreadable`;

describe.skipIf(!hasBrowser)("a playing capture motion blur preview in Chrome", () => {
  let browser: Browser;
  let supported = false;

  beforeAll(async () => {
    ({ browser, supported } = await launch());
  }, 30_000);
  afterAll(() => closeTestChrome(browser));

  it.each(playable)(
    "keeps changing while a $name preview plays",
    async (fixture, ctx) => {
      if (!supported) ctx.skip();
      await checkKeepsChanging(browser, fixture);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "KNOWN BUG on main: preview shows a blank frame after play() (capture tier)",
    async (ctx) => {
      if (!supported) ctx.skip();
      const rows = await censusOfAll(browser);
      const summary = rows.map(describeRow).join("; ");
      const total = (pick: (census: BlankCensus) => number): number =>
        rows.reduce((sum, row) => sum + pick(row.census), 0);
      expect(
        total((c) => c.unreadable),
        `the output canvas has no 2d context, so the detector is blind and cannot see a blank frame (${summary})`,
      ).toBe(0);
      expect(
        total((c) => c.wrapped),
        `the detector did not see every fixture's root wrapped, so it cannot see a blank frame (${summary})`,
      ).toBe(rows.length);
      expect(
        total((c) => c.blank),
        `no blank frame seen after play(). Either the bug is fixed (delete this case, keep the wrapped > 0 guard and assert blank == 0) or the wrap no longer leaves the output empty (${summary})`,
      ).toBeGreaterThan(0);
    },
    CASE_TIMEOUT_MS * 2,
  );
});

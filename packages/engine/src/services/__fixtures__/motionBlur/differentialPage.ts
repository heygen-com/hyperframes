import type { Browser, Page } from "puppeteer-core";
import { expect, it } from "vitest";
import {
  compareTiles,
  meanFrame,
  trailMask,
  type Differential,
  type Rgba,
} from "../blurDifferential.js";
import { closeTestChrome } from "../loopback.js";
import { captureFrame, launch, openFixture } from "./blurPage.js";
import { FIXTURES, type BlurFixture } from "./fixtures.js";
import { INVARIANTS } from "./thresholds.js";

export const FPS = 30;
export const frameTime = (n: number): number => n / FPS;
export const SUB_FRAME_DIVISIONS = 24;
export const SHUTTER_SECONDS = 240 / 360 / FPS;
export const CASE_TIMEOUT_MS = 60_000;

export type Tier = "capture" | "filter";

export const radiusPx = (f: BlurFixture): number => Math.ceil(2 * f.dpr);
export const sizeOf = (f: BlurFixture): { width: number; height: number } => ({
  width: f.width,
  height: f.height,
});

export async function onFreshPage<T>(
  browser: Browser,
  f: BlurFixture,
  blur: "on" | "off",
  use: (page: Page) => Promise<T>,
  tier?: Tier,
): Promise<T> {
  const page = await openFixture(browser, f.html(blur, tier), f.dpr, sizeOf(f));
  try {
    return await use(page);
  } finally {
    await page.close();
  }
}

export async function captureInOrder(
  page: Page,
  times: readonly number[],
  options?: { subFrameDivisions?: number },
): Promise<Rgba[]> {
  const frames: Rgba[] = [];
  for (const t of times) frames.push(await captureFrame(page, t, options));
  return frames;
}

export function neighbourTimes(t: number): number[] {
  const n = Math.round(t * FPS);
  const { radiusFrames } = INVARIANTS;
  return Array.from({ length: 2 * radiusFrames + 1 }, (_, k) => frameTime(n - radiusFrames + k));
}

export function shutterTimes(t: number): number[] {
  const { shutterSamples } = INVARIANTS;
  return Array.from(
    { length: shutterSamples },
    (_, k) => t - SHUTTER_SECONDS / 2 + ((k + 0.5) * SHUTTER_SECONDS) / shutterSamples,
  );
}

export function firstFive(d: Differential): string {
  return JSON.stringify(d.bad.slice(0, 5));
}

export async function measureOutside(
  browser: Browser,
  f: BlurFixture,
  t: number,
  tier?: Tier,
): Promise<Differential> {
  const offFrames = await captureInOrder(await referencePage(f), neighbourTimes(t));
  const onFrame = await onFreshPage(browser, f, "on", (p) => captureFrame(p, t), tier);
  const reference = offFrames[INVARIANTS.radiusFrames];
  if (!reference) throw new Error("missing reference frame");
  return compareTiles(reference, onFrame, trailMask(offFrames, radiusPx(f)), "outside", {
    block: INVARIANTS.block,
    maxMae: INVARIANTS.outsideMaxMae,
  });
}

export const caseName = (what: string, f: BlurFixture, t: number, tier?: Tier): string =>
  `${tier ? `${tier} tier, ` : ""}${what}: ${f.name} at ${t}`;

let launched: Browser | undefined;
let supported = false;

export async function startChrome(): Promise<void> {
  ({ browser: launched, supported } = await launch());
}

export const isSupported = (): boolean => supported;

let reference: { name: string; page: Promise<Page> } | undefined;

async function closeReference(): Promise<void> {
  const open = reference;
  reference = undefined;
  if (open) await (await open.page).close();
}

async function referencePage(f: BlurFixture): Promise<Page> {
  if (reference?.name !== f.name) {
    await closeReference();
    reference = { name: f.name, page: openFixture(chrome(), f.html("off"), f.dpr, sizeOf(f)) };
  }
  return reference.page;
}

export async function stopChrome(): Promise<void> {
  await closeReference();
  await closeTestChrome(launched);
}

export function chrome(): Browser {
  if (!launched) throw new Error("Chrome did not launch");
  return launched;
}

export function fixtureNamed(name: string): BlurFixture {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
}

export function defineOutsideCase(f: BlurFixture, t: number, tier?: Tier): void {
  it(
    caseName("outside the trail, blur on equals blur off", f, t, tier),
    async (ctx) => {
      if (!supported) ctx.skip();
      const d = await measureOutside(chrome(), f, t, tier);
      expect(d.bad, `${f.name} ${firstFive(d)}`).toEqual([]);
      expect(d.checkedFraction).toBeGreaterThanOrEqual(INVARIANTS.minCheckedFraction);
    },
    CASE_TIMEOUT_MS,
  );
}

export function defineInsideCase(f: BlurFixture, t: number, tier?: Tier): void {
  it(
    caseName("inside the trail, blur on matches the shutter average", f, t, tier),
    async (ctx) => {
      if (!supported) ctx.skip();
      const samples = await captureInOrder(await referencePage(f), shutterTimes(t), {
        subFrameDivisions: SUB_FRAME_DIVISIONS,
      });
      const onFrame = await onFreshPage(chrome(), f, "on", (p) => captureFrame(p, t), tier);
      const d = compareTiles(
        meanFrame(samples),
        onFrame,
        trailMask(samples, radiusPx(f)),
        "inside",
        {
          block: INVARIANTS.block,
          maxMae: INVARIANTS.insideMaxMae,
        },
      );
      expect(d.checkedBlocks).toBeGreaterThan(0);
      expect(d.bad, `${f.name} ${firstFive(d)}`).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );
}

// Real Chrome: generated sequences of inline text edits and Design panel text saves, each run sealed and unsealed.
// Every seed: the canvas shows a fresh load of the saved file, the file holds only words some gesture wrote, and
// sealed ends as unsealed does. A seed whose writes all land also ends as the same gestures played one at a time.
// The seeds are split over two files, each a half, so a file stays within the flake gate's run.
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "./chromeTestUtils";
import {
  generated,
  passesDeadline,
  playText,
  wordsFromGestures,
  writeFates,
} from "./inlineTextFixture";
import { buildStudioBundle } from "./sealedPreviewHarness";

const base = Number(process.env.HF_TEXT_SEED_BASE ?? 0);
const listed = process.env.HF_TEXT_SEED_LIST?.split(",").map(Number);
const allSeeds =
  listed ?? Array.from({ length: Number(process.env.HF_TEXT_SEEDS ?? 20) }, (_, i) => base + i + 1);

async function playSeed(browser: Browser, bundle: string, seed: number) {
  const steps = generated(seed);
  const run = (mode: "sealed" | "unsealed", serial = false) =>
    playText(browser, bundle, steps, { mode, seed, serial });
  const sealed = await run("sealed");
  const unsealed = await run("unsealed");
  for (const [mode, result] of [
    ["sealed", sealed],
    ["unsealed", unsealed],
  ] as const) {
    expect.soft({ seed, mode, steps, canvas: result.canvas }).toEqual({
      seed,
      mode,
      steps,
      canvas: result.freshCanvas,
    });
    expect
      .soft({
        seed,
        mode,
        steps,
        saved: result.saved,
        words: wordsFromGestures(result.saved),
      })
      .toMatchObject({
        words: true,
      });
  }
  const trace = (r: typeof sealed) =>
    JSON.stringify({ writes: r.writes, skipped: r.skipped, reported: r.reported });
  const writes = `seed ${seed} sealed ${trace(sealed)} unsealed ${trace(unsealed)}`;
  if (passesDeadline(steps)) {
    const lostQuietly = sealed.saved !== unsealed.saved && sealed.reported.length === 0;
    return void expect
      .soft({ seed, steps, lostQuietly }, writes)
      .toMatchObject({ lostQuietly: false });
  }
  expect
    .soft({ seed, steps, sealed: sealed.saved }, writes)
    .toEqual({ seed, steps, sealed: unsealed.saved });
  if (writeFates(seed).some((fate) => fate !== "land")) return;
  const model = await run("unsealed", true);
  expect.soft({ seed, steps, saved: sealed.saved }).toEqual({ seed, steps, saved: model.saved });
}

export function generatedTextSeeds(half: 0 | 1) {
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 60_000 });
  let browser: Browser;
  let bundle: string;
  beforeAll(async () => {
    browser = await launchTestChrome();
    bundle = await buildStudioBundle([
      `export { mountTextEditing } from "../tests/inlineTextMount";`,
    ]);
  });
  afterAll(() => closeTestChrome(browser));

  const seeds = allSeeds.filter((_, i) => i % 2 === half);
  it.each(seeds)("generated text sequence %i", (seed) => playSeed(browser, bundle, seed));
}

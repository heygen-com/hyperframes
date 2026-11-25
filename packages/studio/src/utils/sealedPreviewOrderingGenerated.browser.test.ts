// Real Chrome, sealed preview: fresh generated sequences of Studio's saves, late replies, scrubs, missed deadlines and
// reloads, each checked against a fresh load of the saved file (sealedOrderingFixture.ts).
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { expectGenerated } from "../../tests/sealedOrderingFixture";
import { buildStudioBundle } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle();
});
afterAll(() => closeTestChrome(browser));

const base = Number(process.env.HF_ORDERING_SEED_BASE ?? 0);
const listed = process.env.HF_ORDERING_SEED_LIST?.split(",").map(Number);
const seeds =
  listed ??
  Array.from({ length: Number(process.env.HF_ORDERING_SEEDS ?? 40) }, (_, i) => base + i + 1);

it.each(seeds)("generated sequence %i", (seed) => expectGenerated(browser, studioBundle, seed));

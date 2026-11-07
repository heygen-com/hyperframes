import { afterAll, beforeAll, describe } from "vitest";
import { hasBrowser } from "./__fixtures__/motionBlur/blurPage.js";
import {
  defineInsideCase,
  defineOutsideCase,
  startChrome,
  stopChrome,
} from "./__fixtures__/motionBlur/differentialPage.js";
import { FIXTURES, type BlurFixture } from "./__fixtures__/motionBlur/fixtures.js";

// One hold and one move per fixture hold the filter tier to the same two invariants. A fixture that
// already expects the filter tier draws with it under the default arm, so it is not repeated here.
function defineFilterCases(f: BlurFixture): void {
  if (f.expectOn.tier === "filter") return;
  const hold = f.checkpoints[Math.floor(f.checkpoints.length / 2)];
  const move = f.moving[Math.floor(f.moving.length / 2)];
  if (hold !== undefined) defineOutsideCase(f, hold, "filter");
  if (move !== undefined) defineInsideCase(f, move, "filter");
}

describe.skipIf(!hasBrowser)("filter tier motion blur against blur off in Chrome", () => {
  beforeAll(startChrome, 30_000);
  afterAll(stopChrome);

  for (const f of FIXTURES) defineFilterCases(f);
});

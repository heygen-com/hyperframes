import { afterAll, beforeAll, describe } from "vitest";
import { hasBrowser } from "./__fixtures__/motionBlur/blurPage.js";
import {
  defineInsideCase,
  startChrome,
  stopChrome,
} from "./__fixtures__/motionBlur/differentialPage.js";
import { FIXTURES } from "./__fixtures__/motionBlur/fixtures.js";

describe.skipIf(!hasBrowser)("capture motion blur inside the trail in Chrome", () => {
  beforeAll(startChrome, 30_000);
  afterAll(stopChrome);

  for (const f of FIXTURES) {
    for (const t of f.moving) defineInsideCase(f, t);
  }
});

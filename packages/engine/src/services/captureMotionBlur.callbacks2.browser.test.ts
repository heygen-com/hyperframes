import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { hasBrowser, launch } from "./__fixtures__/motionBlur/blurPage.js";
import {
  ROW_TIMEOUT_MS,
  expectRowMatchesBlurOff,
  rowsOfGroup,
} from "./__fixtures__/motionBlur/callbackRows.js";

// Rows of the callbacks matrix, group 2 of 3: see callbackRows.ts.
describe.skipIf(!hasBrowser)(
  "capture motion blur leaves timeline callbacks as blur off has them (2 of 3)",
  () => {
    let browser: Browser | undefined;
    let supported = false;

    beforeAll(async () => {
      ({ browser, supported } = await launch());
    }, 30_000);
    afterAll(() => closeTestChrome(browser));

    it.each(rowsOfGroup(1))(
      "row $id, $name: every paint shows what blur off shows, with as many fires",
      async (row, ctx) => {
        if (!supported || !browser) ctx.skip();
        await expectRowMatchesBlurOff(browser as Browser, row);
      },
      ROW_TIMEOUT_MS,
    );
  },
);

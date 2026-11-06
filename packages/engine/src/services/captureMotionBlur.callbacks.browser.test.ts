import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { hasBrowser, launch } from "./__fixtures__/motionBlur/blurPage.js";
import {
  ROW_GROUPS,
  ROW_TIMEOUT_MS,
  MATRIX_ROWS,
  expectRowMatchesBlurOff,
  rowsOfGroup,
} from "./__fixtures__/motionBlur/callbackRows.js";

// Rows of the callbacks matrix, group 1 of 3: see callbackRows.ts.
describe.skipIf(!hasBrowser)(
  "capture motion blur leaves timeline callbacks as blur off has them (1 of 3)",
  () => {
    let browser: Browser | undefined;
    let supported = false;

    beforeAll(async () => {
      ({ browser, supported } = await launch());
    }, 30_000);
    afterAll(() => closeTestChrome(browser));

    it("splits every row of the matrix into exactly one of the three files", () => {
      const ids = ROW_GROUPS.flat().sort();
      expect(ids).toEqual(MATRIX_ROWS.map((row) => row.id).sort());
    });

    it.each(rowsOfGroup(0))(
      "row $id, $name: every paint shows what blur off shows, with as many fires",
      async (row, ctx) => {
        if (!supported || !browser) ctx.skip();
        await expectRowMatchesBlurOff(browser as Browser, row);
      },
      ROW_TIMEOUT_MS,
    );
  },
);

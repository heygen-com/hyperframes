// Real Chrome, sealed and unsealed: words selected in an open text edit show the formatting toolbar over them, and
// its Bold saves them as one span.
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../../tests/chromeTestUtils";
import { file, page } from "../../../tests/inlineTextFixture";
import type { TextEditing } from "../../../tests/inlineTextMount";
import { buildStudioBundle } from "../../../tests/sealedPreviewHarness";
import { openStudio } from "../../../tests/sealedPreviewSequence";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
const WORDS = "Launch day news";
let browser: Browser;
let bundle: string;

type Editing = {
  __text: TextEditing;
  __hold: boolean;
  hfStudio: { mountTextEditing: (...args: unknown[]) => TextEditing };
};

beforeAll(async () => {
  browser = await launchTestChrome();
  bundle = await buildStudioBundle([
    `export { mountTextEditing } from "../tests/inlineTextMount";`,
  ]);
});
afterAll(() => closeTestChrome(browser));

async function boldMiddleWord(mode: string) {
  const { page: studio, frame } = await openStudio(browser, bundle, page(WORDS), 2, mode);
  try {
    // The test page has none of Studio's stylesheet; the toolbar's placement needs its own position.
    await studio.addStyleTag({ content: ".fixed { position: fixed; }" });
    await studio.evaluate(
      async (sealed, saved) => {
        const w = window as unknown as Editing;
        w.__hold = false;
        const iframe = document.querySelector("iframe");
        w.__text = w.hfStudio.mountTextEditing(iframe, sealed, saved, "t", () => {});
        w.__text.controls().start((await w.__text.select()).element);
      },
      mode === "sealed",
      file(WORDS),
    );
    await frame.waitForFunction(() => document.getElementById("t")!.isContentEditable);
    await frame.evaluate(() => {
      const words = document.getElementById("t")!.firstChild!;
      const range = document.createRange();
      range.setStart(words, "Launch ".length);
      range.setEnd(words, "Launch day".length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    const bold = await studio
      .waitForSelector('[data-inline-text-toolbar] [aria-label="Bold"]', { timeout: 5_000 })
      .catch(() => null);
    if (!bold) return { toolbar: false, saved: null };
    await bold.click();
    await frame.waitForFunction(() => document.querySelector("#t span") !== null);
    await studio.evaluate(() => (window as unknown as Editing).__text.controls().commit());
    await studio.waitForFunction(() => {
      const text = (window as unknown as Editing).__text;
      return text.writes.length > 0 && !text.pending();
    });
    const saved = await studio.evaluate(() => (window as unknown as Editing).__text.saved());
    return { toolbar: true, saved };
  } finally {
    await studio.close();
  }
}

it.each(MODES)(
  "words selected in a %s text edit show the toolbar, and Bold saves one span",
  async (mode) => {
    expect(await boldMiddleWord(mode)).toEqual({
      toolbar: true,
      saved: expect.stringMatching(
        /^Launch <span data-hf-id="[\w-]+" style="font-weight: 700;?">day<\/span> news$/,
      ),
    });
  },
);

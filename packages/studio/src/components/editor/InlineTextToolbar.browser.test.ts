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

// Each word's colour as it paints, and the swatch and picker that must show it in both modes.
const COLOURS = {
  variable: { style: "--x: #00ff00; color: var(--x)", swatch: "rgb(0, 255, 0)", picker: "#00ff00" },
  current: { style: "color: currentColor", swatch: "rgb(0, 0, 255)", picker: "#0000ff" },
  named: { style: "color: red", swatch: "rgb(255, 0, 0)", picker: "#ff0000" },
  alpha: {
    style: "color: rgba(255, 0, 0, 0.5)",
    swatch: "rgba(255, 0, 0, 0.5)",
    picker: "#ff0000",
  },
  wide: { style: "color: oklch(0.7 0.4 150)", swatch: "oklch(0.7 0.4 150)", picker: "#00d600" },
};
const COLOURED = Object.entries(COLOURS)
  .map(([id, { style }]) => `<span id="${id}" style="${style}">${id}</span>`)
  .join(" ")
  .replace(/(<span id="current"[^>]*>current<\/span>)/, '<span style="color: blue">$1</span>');

async function colourReadings(mode: string, lie?: string) {
  const { page: studio, frame } = await openStudio(browser, bundle, page(COLOURED), 2, mode);
  try {
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
      file(COLOURED),
    );
    await frame.waitForFunction(() => document.getElementById("t")!.isContentEditable);
    // A composition owns its frame, so it can make the colour the runtime reads as painted say anything.
    if (lie)
      await frame.evaluate((lie) => {
        const computed = window.getComputedStyle.bind(window);
        window.getComputedStyle = (element, pseudo) => {
          const style = computed(element, pseudo);
          const read = style.getPropertyValue.bind(style);
          return Object.assign(Object.create(style), {
            getPropertyValue: (name: string) => (name === "color" ? lie : read(name)),
          });
        };
      }, lie);
    const readings: Record<string, unknown> = {};
    for (const id of Object.keys(COLOURS)) {
      await frame.evaluate(() => getSelection()!.removeAllRanges());
      await studio.waitForFunction(() => !document.querySelector("[data-inline-text-toolbar]"));
      await frame.evaluate((id) => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById(id)!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      }, id);
      await studio.waitForSelector("[data-inline-text-toolbar]");
      readings[id] = await studio.evaluate(() => {
        const bar = document.querySelector("[data-inline-text-toolbar]")!;
        const swatch = bar.querySelector<HTMLElement>("span[aria-hidden]")!;
        return {
          swatch: getComputedStyle(swatch).backgroundColor,
          picker: bar.querySelector<HTMLInputElement>('input[type="color"]')!.value,
          drawn: swatch.getAttribute("style"),
        };
      });
    }
    return readings;
  } finally {
    await studio.close();
  }
}

it.each(MODES)(
  "a %s text edit's swatch and picker show each word's colour as it paints",
  async (mode) => {
    const expected = Object.fromEntries(
      Object.entries(COLOURS).map(([id, { swatch, picker }]) => [
        id,
        { swatch, picker, drawn: expect.any(String) },
      ]),
    );
    expect(await colourReadings(mode)).toEqual(expected);
  },
);

it.each(["url(x)", "red; background: url(x)"])(
  "a sealed frame that calls %s a colour gets none of it into Studio's swatch",
  async (lie) => {
    const readings = Object.values(await colourReadings("sealed", lie));
    expect(readings.map((reading) => JSON.stringify(reading)).join()).not.toContain("url(");
  },
);

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer, { type Browser } from "puppeteer-core";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const gsapScript = readFileSync(
  createRequire(new URL("../../../core/package.json", import.meta.url)).resolve(
    "gsap/dist/gsap.min.js",
  ),
  "utf8",
);

/** A flag, a ZWJ family, a combining accent and a decomposed (NFD) Hangul syllable. */
const CLUSTERS = ["🇰🇷", "👨‍👩‍👧", "é", "한"];
const TEXT = `서울 ${CLUSTERS.join(" ")}`;

const ITEMS = [
  {
    path: "blocks/chatgpt-exchange/chatgpt-exchange.html",
    variable: "prompt",
    spans: "#cge-typed .ch",
  },
  {
    path: "blocks/claude-exchange/claude-exchange.html",
    variable: "prompt",
    spans: "#cle-typed .ch",
  },
  { path: "components/notes-typing/notes-typing.html", variable: "lines", spans: ".nty-ch" },
  {
    path: "components/top-down-letters/top-down-letters.html",
    variable: "text",
    spans: ".hf-catalog-top-down-letters span",
  },
];

/** The item with GSAP inlined, its <template> unwrapped and its variables set before it runs. */
function itemHtml(path: string, variables: Record<string, string>): string {
  const stub = `<script>window.__hyperframes = { getVariables: () => (${JSON.stringify(variables)}) };</script>`;
  const html = readFileSync(
    new URL(`../../../../registry/${path}`, import.meta.url),
    "utf8",
  ).replace(/<script src="https:[^"]*gsap[^"]*"><\/script>/, `<script>${gsapScript}</script>`);
  return stub + html.replace(/<\/?template>/g, "");
}

describe.runIf(executablePath)(
  "registry items that split user text into one span per character",
  () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
    });

    afterAll(async () => {
      await browser?.close();
    });

    async function spanTexts(item: (typeof ITEMS)[number]): Promise<string[]> {
      const page = await browser.newPage();
      try {
        await page.setContent(itemHtml(item.path, { [item.variable]: TEXT }));
        return await page.$$eval(item.spans, (spans) =>
          spans.map((span) => (span.textContent ?? "").replace(/\s/g, " ")),
        );
      } finally {
        await page.close();
      }
    }

    for (const item of ITEMS) {
      it(`${item.path} keeps every grapheme in one span`, async () => {
        const texts = await spanTexts(item);
        expect(texts.join("")).toBe(TEXT);
        for (const cluster of CLUSTERS) expect(texts).toContain(cluster);
        expect(texts.filter((text) => /\p{Cs}/u.test(text))).toEqual([]);
      });
    }
  },
);

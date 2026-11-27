import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import type {} from "../../../core/src/runtime/window";

const RUNTIME_PATH = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");

describe("a render page", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  // Studio's drag chrome only arrives over the editing port, so a page that never hands one over never paints it.
  it("hands out no editing port, so it never paints drag chrome", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html>
        <div data-composition-id="root" data-start="0" data-duration="3" data-width="320" data-height="180">
          <div id="card" style="width:40px;height:40px"></div></div>`);
      await page.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
      await page.waitForFunction(() => window.__playerReady && window.__renderReady);
      const seen = await page.evaluate(async () => {
        const types: unknown[] = [];
        const marker = (name: string) =>
          new Promise<void>((done) => {
            window.addEventListener("message", (event) => {
              if (event.data?.type === name) done();
            });
            window.postMessage({ type: name }, "*");
          });
        window.addEventListener("message", (event) => types.push(event.data?.type));
        window.postMessage({ source: "hf-parent", type: "editing-connect", v: 1 }, "*");
        // A port handed over while the connect is handled is queued ahead of the second marker.
        await marker("first-marker");
        await marker("second-marker");
        window.__player!.renderSeek!(1);
        const tags = Array.from(document.documentElement.children, (child) => child.tagName);
        return { types, tags };
      });
      expect(seen.types).toContain("editing-connect");
      expect(seen.types).not.toContain("editing-port");
      expect(seen.tags).toEqual(["HEAD", "BODY"]);
    } finally {
      await page.close();
    }
  }, 30_000);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";

const RUNTIME_PATH = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");

describe("core runtime browser contract", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    page = await browser.newPage();
    await page.setContent(`<!doctype html>
      <style>
        @keyframes slide { from { transform: translateX(0); } to { transform: translateX(100px); } }
        #box { animation: slide 2s linear both; }
      </style>
      <div data-composition-id="root" data-start="0" data-duration="2" data-width="320" data-height="180">
        <div id="box"></div>
      </div>`);
    await page.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
    await page.waitForFunction(
      () =>
        (window as unknown as { __playerReady?: boolean }).__playerReady === true &&
        (window as unknown as { __renderReady?: boolean }).__renderReady === true,
    );
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("initializes the public player contract and seeks the CSS adapter", async () => {
    const result = await page.evaluate(() => {
      const runtimeWindow = window as unknown as {
        __player?: {
          play?: () => void;
          pause?: () => void;
          renderSeek?: (timeSeconds: number) => void;
          getDuration?: () => number;
          isPlaying?: () => boolean;
        };
      };
      const player = runtimeWindow.__player;
      player?.renderSeek?.(1);
      const animation = document.getElementById("box")?.getAnimations()[0];
      return {
        hasPlay: typeof player?.play === "function",
        hasPause: typeof player?.pause === "function",
        hasRenderSeek: typeof player?.renderSeek === "function",
        duration: player?.getDuration?.(),
        animationTime: Number(animation?.currentTime),
      };
    });

    expect(result).toEqual({
      hasPlay: true,
      hasPause: true,
      hasRenderSeek: true,
      duration: 2,
      animationTime: 1000,
    });
  });

  it("removes the control bridge during teardown", async () => {
    const result = await page.evaluate(async () => {
      const runtimeWindow = window as unknown as {
        __hfRuntimeTeardown?: (() => void) | null;
        __player?: { isPlaying?: () => boolean };
      };
      const hadTeardown = typeof runtimeWindow.__hfRuntimeTeardown === "function";
      runtimeWindow.__hfRuntimeTeardown?.();
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "hf-parent", type: "control", action: "play" },
        }),
      );
      await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame(undefined)));
      return {
        hadTeardown,
        teardownCleared: runtimeWindow.__hfRuntimeTeardown === null,
        isPlaying: runtimeWindow.__player?.isPlaying?.(),
      };
    });

    expect(result).toEqual({ hadTeardown: true, teardownCleared: true, isPlaying: false });
  });
});

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

  it.each([24, 30, 60, 30_000 / 1_001])(
    "keeps the real public player running across a seek at %s fps",
    async (fps) => {
      const fpsPage = await browser.newPage();
      try {
        await fpsPage.setContent(`<!doctype html>
          <style>
            @keyframes slide {
              from { transform: translateX(0); }
              to { transform: translateX(100px); }
            }
            #box { animation: slide 4s linear both; }
          </style>
          <div
            data-composition-id="root"
            data-start="0"
            data-duration="4"
            data-width="320"
            data-height="180"
          >
            <div id="box"></div>
          </div>`);
        await fpsPage.evaluate((runtimeFps) => {
          (
            window as unknown as {
              __HF_EXPORT_RENDER_SEEK_CONFIG?: {
                fps: number;
                fpsSource: "render-options";
              };
            }
          ).__HF_EXPORT_RENDER_SEEK_CONFIG = {
            fps: runtimeFps,
            fpsSource: "render-options",
          };
        }, fps);
        await fpsPage.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
        await fpsPage.waitForFunction(
          () =>
            (window as unknown as { __playerReady?: boolean }).__playerReady === true &&
            (window as unknown as { __renderReady?: boolean }).__renderReady === true,
        );

        const result = await fpsPage.evaluate(async () => {
          const player = (
            window as unknown as {
              __player?: {
                play: () => void;
                seek: (timeSeconds: number, options?: { keepPlaying?: boolean }) => void;
                getTime: () => number;
                isPlaying: () => boolean;
              };
            }
          ).__player;
          if (!player) throw new Error("runtime player was not installed");

          player.play();
          player.seek(1.123, { keepPlaying: true });
          const timeAfterSeek = player.getTime();
          const playingAfterSeek = player.isPlaying();
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));

          return {
            timeAfterSeek,
            playingAfterSeek,
            timeAfterDelay: player.getTime(),
            playingAfterDelay: player.isPlaying(),
          };
        });

        const expectedSeek = Math.floor(1.123 * fps + 1e-9) / fps;
        expect(result.timeAfterSeek).toBeCloseTo(expectedSeek, 1);
        expect(result.playingAfterSeek).toBe(true);
        expect(result.playingAfterDelay).toBe(true);
        expect(result.timeAfterDelay).toBeGreaterThan(result.timeAfterSeek + 0.04);
      } finally {
        await fpsPage.close();
      }
    },
    30_000,
  );

  it("un-hides a later root-level video once active, even though it starts inactive and unstyled", async () => {
    // Root-level `[data-start]` children with no authored `position` start out
    // `position: static` until the runtime force-absolutizes them, so a
    // visibility pass over the still-inactive second clip can observe `static`
    // and cache it as in-flow before that forcing runs. That cached reading used
    // to poison the later un-hide check and leave the clip stuck `display:none`
    // for the rest of the render once it became active.
    const videoPage = await browser.newPage();
    try {
      await videoPage.setContent(`<!doctype html>
        <div
          data-composition-id="root"
          data-start="0"
          data-duration="20"
          data-width="320"
          data-height="240"
        >
          <video id="clip-a" data-start="0" data-duration="10" width="320" height="240" muted></video>
          <video id="clip-b" data-start="10" data-duration="10" width="320" height="240" muted></video>
        </div>`);
      await videoPage.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
      await videoPage.waitForFunction(
        () =>
          (window as unknown as { __playerReady?: boolean }).__playerReady === true &&
          (window as unknown as { __renderReady?: boolean }).__renderReady === true,
      );

      const seekAndReadClipB = (seekTo: number) =>
        videoPage.evaluate((timeSeconds) => {
          const player = (
            window as unknown as { __player?: { renderSeek: (timeSeconds: number) => void } }
          ).__player;
          if (!player) throw new Error("runtime player was not installed");
          player.renderSeek(timeSeconds);

          const clip = document.getElementById("clip-b");
          if (!clip) throw new Error("clip-b was not found");
          const computed = window.getComputedStyle(clip);
          return {
            display: computed.display,
            visibility: computed.visibility,
            offsetWidth: clip.offsetWidth,
          };
        }, seekTo);

      // Evaluate the still-inactive second clip at least once before it
      // becomes active — the shape that used to poison the cache.
      const beforeActive = await seekAndReadClipB(0);
      expect(beforeActive.visibility).toBe("hidden");

      const afterActive = await seekAndReadClipB(15);
      expect(afterActive.visibility).toBe("visible");
      expect(afterActive.display).not.toBe("none");
      expect(afterActive.offsetWidth).toBeGreaterThan(0);
    } finally {
      await videoPage.close();
    }
  }, 30_000);

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

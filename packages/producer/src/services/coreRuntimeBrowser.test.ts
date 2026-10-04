import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";

const RUNTIME_PATH = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

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

  it.each([
    { name: "running after 80 ms", elapsed: 80 },
    { name: "running after 250 ms", elapsed: 250 },
    { name: "positive delay", elapsed: 80, delay: 500 },
    { name: "negative delay", elapsed: 80, delay: -500 },
    { name: "reverse keyframes", elapsed: 80, reverse: true },
    { name: "finished before discovery", elapsed: 200, duration: 200 },
    { name: "paused authored offset", elapsed: 80, paused: true, offset: 500 },
    { name: "paused at zero", elapsed: 80, paused: true, offset: 0 },
    { name: "running currentTime is not a baseline offset", elapsed: 80, offset: 500 },
  ])(
    "seeks initial WAAPI in composition time: $name",
    async ({
      elapsed,
      delay = 0,
      duration = 4000,
      reverse = false,
      paused = false,
      offset = 0,
    }) => {
      const animationPage = await browser.newPage();
      try {
        await animationPage.setContent(`<!doctype html>
          <div data-composition-id="root" data-root="true" data-no-timeline
            data-start="0" data-duration="4" data-width="320" data-height="180">
            <div id="waapi-box" class="clip" data-start="0" data-duration="4"></div>
          </div>`);
        await animationPage.evaluate(
          ({ delay, duration, reverse, paused, offset }) => {
            const box = document.getElementById("waapi-box");
            if (!box) throw new Error("waapi-box missing");
            const animation = box.animate(
              [{ transform: "translateX(0px)" }, { transform: "translateX(100px)" }],
              { duration, delay, direction: reverse ? "reverse" : "normal", fill: "both" },
            );
            if (paused) animation.pause();
            if (offset || paused) animation.currentTime = offset;
          },
          { delay, duration, reverse, paused, offset },
        );
        if (!paused) {
          // Wait for actual browser progress, not a guessed sleep duration.
          await animationPage.waitForFunction(
            (minimumTime) =>
              Number(document.getElementById("waapi-box")?.getAnimations()[0]?.currentTime) >=
              minimumTime,
            {},
            elapsed + offset,
          );
        }
        await animationPage.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
        await animationPage.waitForFunction(
          () =>
            (window as unknown as { __playerReady?: boolean }).__playerReady === true &&
            (window as unknown as { __renderReady?: boolean }).__renderReady === true,
        );
        const times = duration === 200 ? [0, 0.1, 1 / 6, 0.1] : [0, 2, 3, 2];
        const samples = await animationPage.evaluate(async (times) => {
          // The runtime is injected as a built script, outside this test's module graph.
          const player = (
            window as unknown as {
              __player: { seek: (time: number) => void; renderSeek: (time: number) => void };
            }
          ).__player;
          const box = document.getElementById("waapi-box");
          if (!box || !player) throw new Error("WAAPI fixture did not initialize");
          const samples = [];
          for (const method of ["seek", "renderSeek"] as const) {
            for (const time of times) {
              await player[method](time);
              samples.push({
                time,
                x: new DOMMatrixReadOnly(getComputedStyle(box).transform).m41,
                playState: box.getAnimations()[0]?.playState,
              });
            }
          }
          return samples;
        }, times);
        for (const sample of samples) {
          const localTime = sample.time * 1000 + (paused ? offset : 0) - delay;
          const progress = Math.max(0, Math.min(1, localTime / duration));
          expect(sample.x).toBeCloseTo((reverse ? 1 - progress : progress) * 100, 3);
          expect(sample.playState).toBe("paused");
        }
      } finally {
        await animationPage.close();
      }
    },
    30_000,
  );

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

  it("renders a later clip's authored lazy image as it is: laid out at setup, fetched before any seek", async () => {
    // A chunked render starts a worker straight at a later clip, so its image must already be loaded.
    const assets = "https://assets.test/";
    const renderPage = await browser.newPage();
    try {
      await renderPage.setRequestInterception(true);
      renderPage.on("request", (request) => {
        if (request.url() === `${assets}runtime.js`)
          void request.respond({
            contentType: "text/javascript",
            body: readFileSync(RUNTIME_PATH),
          });
        else if (request.url() === `${assets}plate.png`)
          void request.respond({ contentType: "image/png", body: Buffer.from(PNG_1PX, "base64") });
        else void request.continue();
      });
      await renderPage.setContent(`<!doctype html><html><head>
        <style>.clip { position: absolute; inset: 0; }</style>
        <script src="${assets}runtime.js"></script></head><body>
        <div data-composition-id="root" data-start="0" data-duration="4" data-width="320" data-height="180">
          <div class="clip" data-start="0" data-duration="2.5" data-track-index="1"></div>
          <div class="clip" data-start="2.5" data-duration="1.5" data-track-index="1">
            <img id="plate" loading="lazy" width="200" height="100" src="${assets}plate.png">
          </div>
        </div>
        <script>window.__plateWidthAtSetup = document.getElementById("plate").offsetWidth;</script>
        </body></html>`);
      await renderPage.waitForFunction(
        () => (window as unknown as { __renderReady?: boolean }).__renderReady === true,
      );
      const loaded = await renderPage
        .waitForFunction(
          () => {
            const plate = document.getElementById("plate") as HTMLImageElement;
            return plate.complete && plate.naturalWidth > 0;
          },
          { timeout: 5_000 },
        )
        .then(() => true)
        .catch(() => false);
      const atClip = await renderPage.evaluate(() => {
        const runtime = window as unknown as {
          __plateWidthAtSetup?: number;
          __player?: { renderSeek: (timeSeconds: number) => void };
        };
        runtime.__player?.renderSeek(2.6);
        return {
          setupWidth: runtime.__plateWidthAtSetup,
          width: document.getElementById("plate")?.offsetWidth,
        };
      });
      expect({ loaded, ...atClip }).toEqual({ loaded: true, setupWidth: 200, width: 200 });
    } finally {
      await renderPage.close();
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import type {} from "../../../core/src/runtime/window";
import { openComposition } from "../../../sdk/src/session";
import {
  computeStaticFrameSet,
  waitForPendingSeekCompletion,
} from "../../../engine/src/services/frameCapture";

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

  it("disables static dedup for an async frame source even alongside a GSAP tween", async () => {
    const sourcePage = await browser.newPage();
    try {
      await sourcePage.setContent(
        `<div id="source" data-composition-id="root" data-start="0" data-duration="2" data-width="320" data-height="180"><div id="probe"></div></div>`,
      );
      await sourcePage.addScriptTag({
        path: resolve(import.meta.dirname, "../../../core/node_modules/gsap/dist/gsap.min.js"),
      });
      await sourcePage.addScriptTag({
        content:
          'window.__timelines = {root:gsap.timeline({paused:true}).to("#probe",{opacity:0.5,duration:0.1})};',
      });
      await sourcePage.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
      await sourcePage.waitForFunction(() => window.__playerReady && window.__renderReady);
      await sourcePage.evaluate(() => {
        window.__hf = { duration: window.__player!.getDuration!() };
      });
      const baseline = await computeStaticFrameSet(sourcePage, 30);
      expect(baseline.reason).toBe("eligible");
      expect(baseline.eligible).toBe(true);
      await sourcePage.evaluate(() => {
        const element = document.getElementById("source")!;
        window.__hyperframes!.registerFrameSource({
          element,
          render: async (time) => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            element.setAttribute("data-rendered-time", String(time));
          },
        });
        window.__player!.renderSeek!(0.5);
      });
      await waitForPendingSeekCompletion(sourcePage);
      expect(await sourcePage.$eval("#source", (el) => el.getAttribute("data-rendered-time"))).toBe(
        "0.5",
      );
      const analysis = await computeStaticFrameSet(sourcePage, 30);
      expect(analysis.tweenCount).toBeGreaterThan(0);
      expect(analysis.eligible).toBe(false);
      expect(analysis.staticFrameSet.size).toBe(0);
      expect(analysis.reason).toContain("registered frame source");
      await sourcePage.evaluate(() => document.body.appendChild(document.createElement("iframe")));
      expect((await computeStaticFrameSet(sourcePage, 30)).reason).toContain("iframe");
    } finally {
      await sourcePage.close();
    }
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

  it("keeps each loaded sub-composition's SVG clip ids pointing into its own section", async () => {
    // Figma exports restart clip ids per file, so both scenes declare clip0_1_2..clip2_1_2.
    const origin = "https://fixture.test/";
    const icon = (clip: string | null) =>
      clip
        ? `<svg viewBox="0 0 24 24"><g clip-path="url(#${clip})"><path d="M0 0h24v24H0z"/></g>` +
          `<defs><clipPath id="${clip}"><rect width="24" height="24" rx="6"/></clipPath></defs></svg>`
        : `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`;
    const clipAt = new Map([
      [0, "clip0_1_2"],
      [1, "clip1_1_2"],
      [15, "clip2_1_2"],
    ]);
    const deferredLookup = (section: string) => `<script>
      var svg = document.querySelector("svg");
      var target = svg.querySelector("clipPath");
      window.__svgLookups = window.__svgLookups || {};
      window.__svgLookups[${JSON.stringify(section)}] = function() {
        return {
          document: document.querySelector("#clip0_1_2") === target,
          documentAll: document.querySelectorAll("#clip0_1_2")[0] === target,
          element: svg.querySelector("#clip0_1_2") === target,
          elementAll: svg.querySelectorAll("#clip0_1_2")[0] === target,
        };
      };
    </script>`;
    const scenes: Record<string, string> = {
      "scenes/intro.html": `<template id="intro-template"><div data-composition-id="intro" data-width="320" data-height="180" data-duration="3">${[...clipAt.values()].map(icon).join("")}${deferredLookup("intro")}</div></template>`,
      "scenes/grid.html": `<template id="grid-template"><div data-composition-id="grid" data-width="320" data-height="180" data-duration="5">${Array.from(
        { length: 16 },
        (_, i) => `<div class="tile">${icon(clipAt.get(i) ?? null)}</div>`,
      ).join("")}${deferredLookup("grid")}</div></template>`,
      "index.html": `<!doctype html><html><body>
        <div data-composition-id="main" data-start="0" data-duration="8" data-width="320" data-height="180">
          <div id="intro" class="clip" data-composition-id="intro" data-composition-src="scenes/intro.html" data-start="0" data-duration="3" data-track-index="0"></div>
          <div id="grid" class="clip" data-composition-id="grid" data-composition-src="scenes/grid.html" data-start="3" data-duration="5" data-track-index="0"></div>
        </div>
        <script src="${origin}runtime.js"></script></body></html>`,
    };
    const scenePage = await browser.newPage();
    try {
      await scenePage.setRequestInterception(true);
      scenePage.on("request", (request) => {
        const path = request.url().slice(origin.length);
        if (path === "runtime.js")
          void request.respond({
            contentType: "text/javascript",
            body: readFileSync(RUNTIME_PATH),
          });
        else if (scenes[path])
          void request.respond({ contentType: "text/html", body: scenes[path] });
        else void request.continue();
      });
      await scenePage.goto(`${origin}index.html`);
      await scenePage.waitForFunction(
        () => (window as unknown as { __renderReady?: boolean }).__renderReady === true,
      );

      const strays = await scenePage.evaluate(() =>
        ["intro", "grid"].map((section) => {
          const host = document.getElementById(section)!;
          const refs = [...host.querySelectorAll("[clip-path]")].map(
            (el) => /#([^)"']+)/.exec(el.getAttribute("clip-path")!)![1]!,
          );
          return {
            section,
            refs: refs.length,
            outside: refs.filter((id) => !host.contains(document.getElementById(id))),
            lookups: (
              window as unknown as {
                __svgLookups: Record<string, () => Record<string, boolean>>;
              }
            ).__svgLookups[section]!(),
          };
        }),
      );
      expect(strays).toEqual([
        {
          section: "intro",
          refs: 3,
          outside: [],
          lookups: { document: true, documentAll: true, element: true, elementAll: true },
        },
        {
          section: "grid",
          refs: 3,
          outside: [],
          lookups: { document: true, documentAll: true, element: true, elementAll: true },
        },
      ]);
    } finally {
      await scenePage.close();
    }
  }, 30_000);

  const cssTokenSelectors = [
    'use[/**/href="#symbol"]',
    'use[href/**/="#symbol"]',
    'use[href=/**/"#symbol"]',
    'use[href="#symbol"/**/i]',
    'use[href="#symbol"/**/]',
    'use[href/* ] " */="#symbol"]',
    String.raw`use[href="#SYMBOL" \69]`,
  ];
  const invalidCssSelectors = [
    "[id=1]",
    "#1",
    "#-1",
    'use[hr/**/ef="#symbol"]',
    "use[href=foo/**/bar]",
    'use[href="#symbol" s]',
    'use[xl|href="#symbol"]',
  ];

  const svgReviewCases: Array<{
    name: string;
    external: boolean;
    content: string;
    script: string;
    expected: Record<string, string | boolean>;
    lateHtml?: boolean;
  }> = [
    {
      name: "CSS token grammar and native errors",
      external: false,
      content: `<style>${cssTokenSelectors.map((selector, index) => `${selector} { --case-${index}: yes }`).join("\n")}</style><svg><symbol id="symbol"/><path id="1"/><path id="-1"/><use href="#symbol"/><use href="#1"/><use href="#-1"/></svg><div id="1"></div><div id="-1"></div>`,
      script: `var svg = document.querySelector('svg');
        var target = svg.querySelector('use');
        window.__svgReviewProbe = function() {
          var selectors = ${JSON.stringify(cssTokenSelectors)};
          var invalid = ${JSON.stringify(invalidCssSelectors)};
          var native = window.document.createElementNS('http://www.w3.org/2000/svg', 'use');
          native.setAttribute('href', '#symbol');
          function syntaxError(fn) { try { fn(); return false; } catch(error) { return error.name === 'SyntaxError'; } }
          function bits(values) { return values.map(function(value) { return value ? '1' : '0'; }).join(''); }
          return {
            native: bits(selectors.map(function(selector) { return native.matches(selector); })),
            scoped: bits(selectors.map(function(selector) { return svg.querySelector(selector) === target; })),
            css: bits(selectors.map(function(_, index) { return getComputedStyle(target).getPropertyValue('--case-' + index).trim() === 'yes'; })),
            invalidNative: bits(invalid.map(function(selector) { return syntaxError(function() { native.matches(selector); }); })),
            invalidScoped: bits(invalid.map(function(selector) { return syntaxError(function() { svg.querySelector(selector); }); })),
          };
        };`,
      expected: {
        native: "1111111",
        scoped: "1111111",
        css: "1111111",
        invalidNative: "1111111",
        invalidScoped: "1111111",
      },
    },
    {
      name: "Declared attribute namespace CSS",
      external: false,
      content: `<style>@charset "UTF-8"; @unknown foo; @layer empty; #1 {} @NAMESPACE xl url("http://www.w3.org/1999/xlink"); @namespace ed "urn:editor"; use[xl|href="#symbol"] { opacity: .4 } use[ed|href="#symbol"] { --wrong-namespace: yes } @media all { use[xl|href="#symbol"] { --nested: yes } } @media all { @namespace xl "urn:ignored"; } @namespace xl "urn:late";</style><svg xmlns:xlink="http://www.w3.org/1999/xlink"><symbol id="symbol"/><use xlink:href="#symbol" href="#symbol"/></svg>`,
      script: `var target = document.querySelector('svg use');
        target.setAttributeNS('urn:editor', 'ed:href', target.getAttribute('href'));
        window.__svgReviewProbe = function() {
          var style = window.document.createElement('style');
          style.textContent = '@namespace xl url("http://www.w3.org/1999/xlink"); .namespace-native[xl|href="#symbol"] { opacity: .4 }';
          window.document.head.appendChild(style);
          var svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          var use = window.document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('class', 'namespace-native');
          use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#symbol');
          svg.appendChild(use); window.document.body.appendChild(svg);
          var repaired = Array.from(window.document.styleSheets).flatMap(function(sheet) { return Array.from(sheet.cssRules); })
            .find(function(rule) { var text = rule.selectorText || ''; return text.indexOf('xl|href') !== -1 && !/namespace-native/.test(text) && /opacity/.test(rule.cssText); });
          var repairedBefore = repaired.selectorText;
          window.__hfSvgSelectorAliases.refresh();
          var stable = repaired.selectorText === repairedBefore;
          repaired.selectorText = 'svg > use[xl|href="#symbol"]';
          window.__hfSvgSelectorAliases.refresh();
          var result = {
            stable: stable,
            authorEdit: repaired.selectorText.indexOf('svg > use') === 0,
            native: getComputedStyle(use).opacity,
            css: getComputedStyle(target).opacity,
            nested: getComputedStyle(target).getPropertyValue('--nested').trim(),
            crossNamespace: getComputedStyle(target).getPropertyValue('--wrong-namespace').trim(),
          };
          svg.remove(); style.remove();
          return result;
        };`,
      expected: {
        stable: true,
        authorEdit: true,
        native: "0.4",
        css: "0.4",
        nested: "yes",
        crossNamespace: "",
      },
    },
    {
      name: "Initial script retargets owned styles",
      external: false,
      content: `<style>.rebound { clip-path: url(#clip) }</style><svg><clipPath id="clip"/><clipPath id="late"/><g class="rebound"/></svg>`,
      script: `var svg = document.querySelector('svg');
        var style = Array.from(window.document.querySelectorAll('style')).find(function(style) { return style.textContent.includes('.rebound'); });
        style.textContent = style.textContent.replace(/url\\([^)]*\\)/, 'url(#late)');
        window.__svgReviewProbe = function() {
          var id = /#([^)]*)/.exec(style.textContent)[1];
          return { own: window.document.getElementById(id) === svg.querySelector('clipPath:last-of-type') };
        };`,
      expected: { own: true },
    },
    {
      name: "Initial script retargets native references",
      external: false,
      content: `<svg><clipPath id="clip"/><clipPath id="late"/><g clip-path="url(#clip)"/></svg>`,
      script: `var svg = document.querySelector('svg');
        var group = svg.querySelector('g');
        group.setAttribute('clip-path', 'url(#late)');
        window.__svgReviewProbe = function() {
          var id = /#([^)]*)/.exec(group.getAttribute('clip-path'))[1];
          return { own: window.document.getElementById(id) === svg.querySelector('clipPath:last-of-type') };
        };`,
      expected: { own: true },
    },
    {
      name: "CSS string continuations",
      external: false,
      content: `<style>use[href="#sym${String.fromCharCode(92, 13, 10)}bol"] { opacity: .4 }</style><svg><symbol id="symbol"/><use href="#symbol"/></svg>`,
      script: `var svg = document.querySelector("svg");
        var use = svg.querySelector("use");
        window.__svgReviewProbe = function() {
          var endings = [[10], [13], [12], [13, 10]];
          var selectors = endings.map(function(ending) { return 'use[href="#sym' + String.fromCharCode(92) + String.fromCharCode.apply(null, ending) + 'bol"]'; });
          return {
            native: selectors.every(function(selector) { return window.document.querySelector('#intro ' + selector) !== null; }),
            scoped: selectors.every(function(selector) { return svg.querySelector(selector) === use; }),
            css: getComputedStyle(use).opacity,
            invalid: endings.every(function(ending) {
              try { svg.querySelector('#sym' + String.fromCharCode(92) + String.fromCharCode.apply(null, ending) + 'bol'); return false; }
              catch (error) { return error.name === 'SyntaxError'; }
            })
          };
        };`,
      expected: { native: true, scoped: true, css: "0.4", invalid: true },
    },
    {
      name: "Escaped closing bracket attribute values",
      external: false,
      content: `<style>${String.raw`use[href=\#sym\]bol]`} { opacity: .4 }</style><svg><symbol id="sym]bol"/><use href="#sym]bol"/></svg><div id="sym]bol"></div>`,
      script: `var svg = document.querySelector('svg');
        var target = svg.querySelector('use');
        window.__svgReviewProbe = function() {
          var selector = 'use[href=' + String.fromCharCode(92) + '#sym' + String.fromCharCode(92) + ']bol]';
          var native = window.document.createElementNS('http://www.w3.org/2000/svg', 'use');
          native.setAttribute('href', '#sym]bol');
          return { native: native.matches(selector), scoped: svg.querySelector(selector) === target,
            css: getComputedStyle(target).opacity };
        };`,
      expected: { native: true, scoped: true, css: "0.4" },
    },
    {
      name: "Multiline native reference attributes",
      external: false,
      content: `<style>.multiline[style*="url(#clip)"] { opacity: .4 }</style><svg><clipPath id="clip"/><g clip-path="url(#clip)"/></svg><div class="multiline" style="\n clip-path:url(#clip);\n"></div>`,
      script: `var target = document.querySelector('.multiline');
        window.__svgReviewProbe = function() {
          var native = window.document.createElement('div');
          native.setAttribute('style', String.fromCharCode(10) + 'clip-path:url(#clip);' + String.fromCharCode(10));
          return { native: native.matches('[style*="url(#clip)"]'),
            scoped: document.querySelector('.multiline[style*="url(#clip)"]') === target,
            css: getComputedStyle(target).opacity };
        };`,
      expected: { native: true, scoped: true, css: "0.4" },
    },
    {
      name: "HTML attribute name casing",
      external: false,
      content: `<style>.html-reference[STYLE*="url(#clip)"] { opacity: .4 }</style><svg><clipPath id="clip"/><g clip-path="url(#clip)"/></svg><div class="html-reference" style="clip-path:url(#clip)"></div>`,
      script: `var target = document.querySelector('.html-reference');
        window.__svgReviewProbe = function() {
          var native = window.document.createElement('div');
          native.setAttribute('style', 'clip-path:url(#clip)');
          return { native: native.matches('[STYLE*="url(#clip)"]'),
            scoped: document.querySelector('.html-reference[STYLE*="url(#clip)"]') === target,
            css: getComputedStyle(target).opacity };
        };`,
      expected: { native: true, scoped: true, css: "0.4" },
    },
    {
      name: "external-only scripts retain authored SVG selectors",
      external: true,
      content: `<svg><clipPath id="clip"><rect width="24" height="24"/></clipPath><g clip-path="url(#clip)"></g></svg>`,
      script: `var host = document.getElementById("grid");
        var svg = host.querySelector("svg");
        var target = svg.querySelector("clipPath");
        window.__svgReviewProbe = function() {
          return { single: svg.querySelector("#clip") === target,
            all: svg.querySelectorAll("#clip")[0] === target };
        };`,
      expected: { single: true, all: true },
    },
    {
      name: "authored native-reference attribute selectors work in scripts and CSS",
      external: false,
      content: `<style>
          use[href="#symbol"] { opacity: .4; }
          use.xlink[*|href="#symbol"] { stroke-width: 7px; }
          g[clip-path="url(#clip)"] { opacity: .6; }
        </style><svg xmlns:xlink="http://www.w3.org/1999/xlink">
          <symbol id="symbol"><rect width="24" height="24"/></symbol><symbol id="Ā"/><use class="unicode" href="#Ā"/>
          <clipPath id="clip"><rect width="24" height="24"/></clipPath>
          <use href="#symbol"></use><use class="xlink" xlink:href="#symbol"></use>
          <g clip-path="url(#clip)"></g><text data-ref="#symbol">label</text>
        </svg><div id="Ā"></div>`,
      script: `var svg = document.querySelector("svg");
        var uses = svg.querySelectorAll("use:not(.unicode)");
        var clipped = svg.querySelector("g");
        window.__svgReviewProbe = function() {
          var result = {
            operators: ['use[href^="#sym"]', 'use[href$="symbol"]', 'use[href*="symb"]', 'use[href~="#symbol"]', 'use[href|="#symbol"]', 'use[href="#SYMBOL" i]', 'use[href=' + String.fromCharCode(92) + '23 symbol]'].every(function(selector) { return svg.querySelector(selector) === uses[0]; }),
            unicode: svg.querySelector('use.unicode[href="#ā" i]') === null,
            href: document.querySelector('use[href="#symbol"]') === uses[0],
            xlink: svg.querySelector('use.xlink[*|href="#symbol"]') === uses[1],
            url: svg.querySelector('g[clip-path="url(#clip)"]') === clipped,
            arbitrary: svg.querySelector('text[data-ref="#symbol"]') !== null,
            hrefCss: getComputedStyle(uses[0]).opacity,
            xlinkCss: getComputedStyle(uses[1]).strokeWidth,
            urlCss: getComputedStyle(clipped).opacity,
          };
          uses[0].setAttribute("href", "#unrelated");
          result.afterChange = svg.querySelector('use[href="#symbol"]') === null;
          result.afterChangeCss = getComputedStyle(uses[0]).opacity;
          uses[1].setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#unrelated");
          result.xlinkAfterChange = svg.querySelector('use.xlink[*|href="#symbol"]') === null;
          result.xlinkAfterChangeCss = getComputedStyle(uses[1]).strokeWidth;
          return result;
        };`,
      expected: {
        operators: true,
        unicode: true,
        href: true,
        xlink: true,
        url: true,
        arbitrary: true,
        hrefCss: "0.4",
        xlinkCss: "7px",
        urlCss: "0.6",
        afterChange: true,
        afterChangeCss: "1",
        xlinkAfterChange: true,
        xlinkAfterChangeCss: "1px",
      },
    },
    {
      name: "scripts capture the final SVG id before a deferred reference write",
      external: false,
      content: `<svg><clipPath id="clip"><rect width="24" height="24"/></clipPath><g clip-path="url(#clip)"></g></svg><div id="clip"></div>`,
      script: `var svg = document.querySelector("svg");
        var target = svg.querySelector("clipPath");
        var capturedId = target.id;
        window.__svgReviewProbe = function() {
          svg.querySelector("g").setAttribute("clip-path", "url(#" + capturedId + ")");
          return { capturedStable: capturedId === target.id,
            correctTarget: window.document.getElementById(capturedId) === target };
        };`,
      expected: { capturedStable: true, correctTarget: true },
    },
    {
      name: "an earlier HTML host finishes mounting before a later SVG script captures its id",
      external: false,
      lateHtml: true,
      content: `<div id="clip">later HTML</div>`,
      script: `var svg = document.querySelector("svg");
        var target = svg.querySelector("clipPath");
        var capturedId = target.id;
        window.__svgReviewProbe = function() {
          svg.querySelector("g").setAttribute("clip-path", "url(#" + capturedId + ")");
          return { capturedStable: capturedId === target.id,
            correctTarget: window.document.getElementById(capturedId) === target };
        };`,
      expected: { capturedStable: true, correctTarget: true },
    },
    {
      name: "initial inline hosts retain borrowed parent SVG references",
      external: false,
      content: `<svg><linearGradient id="paint"><stop stop-color="red"/></linearGradient><rect fill="url(#paint)"/></svg>
        <template id="child-template"><div data-composition-id="child"><style>.borrowed { fill: url(#paint) }</style><svg><rect class="borrowed" fill="url(#paint)"/></svg></div></template>
        <div data-composition-id="child"></div>`,
      script: `var target = document.querySelector("linearGradient");
        window.__svgReviewProbe = function() {
          var child = document.querySelector(".borrowed");
          var attr = /#([^)'"]+)/.exec(child.getAttribute("fill"))[1];
          var css = /#([^)'"]+)/.exec(getComputedStyle(child).fill)[1];
          return { attribute: window.document.getElementById(attr) === target,
            css: window.document.getElementById(css) === target };
        };`,
      expected: { attribute: true, css: true },
    },
    {
      name: "external scripts still create inline hosts that borrow finalized SVG references",
      external: false,
      content: `<svg><linearGradient id="paint"><stop stop-color="red"/></linearGradient><rect fill="url(#paint)"/></svg>`,
      script: `var target = document.querySelector("linearGradient");
        var captured = target.id;
        var template = document.createElement("template");
        template.id = "dynamic-template";
        template.innerHTML = '<div data-composition-id="dynamic"><style>.borrowed { fill: url(#paint) }</style><svg><clipPath id="clip"/><g clip-path="url(#clip)"/><rect class="borrowed" fill="url(#paint)"/></svg></div>';
        var payload = document.createElement("script");
        payload.textContent = 'window.__dynamicMounted = true;';
        template.content.appendChild(payload);
        document.body.appendChild(template);
        var host = document.createElement("div");
        host.setAttribute("data-composition-id", "dynamic");
        document.querySelector("svg").parentElement.appendChild(host);
        window.__svgReviewProbe = function() {
          var child = host.querySelector(".borrowed");
          var attr = /#([^)'"]+)/.exec(child.getAttribute("fill"))[1];
          var css = /#([^)'"]+)/.exec(getComputedStyle(child).fill)[1];
          var clip = /#([^)'"]+)/.exec(host.querySelector("g").getAttribute("clip-path"))[1];
          return { mounted: window.__dynamicMounted === true,
            capturedStable: captured === target.id,
            attribute: window.document.getElementById(attr) === target,
            css: window.document.getElementById(css) === target,
            ownClip: host.contains(window.document.getElementById(clip)) };
        };`,
      expected: { mounted: true, capturedStable: true, attribute: true, css: true, ownClip: true },
    },
    {
      name: "external replacement of an inline host does not run its stale queued script",
      external: false,
      content: `<template id="child-template"><div data-composition-id="child"><style>.replacement { color: red }</style><script>window.__staleInlineRan = true;</script><span>old</span></div></template><div data-composition-id="child"></div>`,
      script: `var child = document.querySelector('[data-composition-id="child"]');
        child.innerHTML = '<span class="replacement">new</span>';
        window.__svgReviewProbe = function() {
          return { replaced: !!child.querySelector(".replacement"), staleRan: window.__staleInlineRan === true,
            color: getComputedStyle(child.querySelector(".replacement")).color };
        };`,
      expected: { replaced: true, staleRan: false, color: "rgb(0, 0, 0)" },
    },
    {
      name: "an inline host emptied by an external script is mounted before its script runs",
      external: false,
      content: `<template id="child-template"><div data-composition-id="child"><script>window.__emptyInlineRan = true;</script><span class="restored">restored</span></div></template><div data-composition-id="child"></div>`,
      script: `var child = document.querySelector('[data-composition-id="child"]');
        child.innerHTML = '';
        window.__svgReviewProbe = function() {
          return { restored: !!child.querySelector(".restored"), ran: window.__emptyInlineRan === true };
        };`,
      expected: { restored: true, ran: true },
    },
    {
      name: "a script-created duplicate preserves the first inline instance identity and variables",
      external: false,
      content: `<template id="scene-template"><div data-composition-id="scene"><style>.instance-probe { color: red }</style><script>window.__instanceValues = window.__instanceValues || []; window.__instanceValues.push(__hyperframes.getVariables().label);</script><span class="instance-probe">instance</span></div></template><div data-composition-id="scene" data-variable-values='{"label":"first"}'></div>`,
      script: `var first = document.querySelector('[data-composition-id="scene"]');
        var second = document.createElement("div");
        second.setAttribute("data-composition-id", "scene");
        second.setAttribute("data-variable-values", JSON.stringify({ label: "second" }));
        first.parentElement.appendChild(second);
        window.__svgReviewProbe = function() {
          return { values: (window.__instanceValues || []).join(","),
            colors: [first, second].every(function(host) { return getComputedStyle(host.querySelector(".instance-probe")).color === "rgb(255, 0, 0)"; }),
            distinct: first.getAttribute("data-composition-id") !== second.getAttribute("data-composition-id") };
        };`,
      expected: { values: "first,second", colors: true, distinct: true },
    },
    {
      name: "a discovered earlier definition preserves existing authored borrowed references",
      external: false,
      content: `<style>.borrowed { fill: url(#paint) }</style><svg><rect class="borrowed" fill="url(#paint)"/></svg><template id="local-template"><div data-composition-id="local"><svg><linearGradient id="paint"><stop stop-color="green"/></linearGradient><rect class="owned-paint" fill="url(#paint)"/></svg></div></template><div data-composition-id="local"></div>`,
      script: `var borrowed = document.querySelector(".borrowed");
        var local = document.querySelector(".owned-paint");
        var localTarget = local.parentElement.querySelector("linearGradient");
        var localId = localTarget.id;
        var template = document.createElement("template");
        template.id = "newpaint-template";
        template.innerHTML = '<div data-composition-id="newpaint"><svg><linearGradient id="paint"><stop stop-color="red"/></linearGradient><rect fill="url(#paint)"/></svg></div>';
        document.body.appendChild(template);
        var host = document.createElement("div");
        host.setAttribute("data-composition-id", "newpaint");
        var own = document.getElementById("grid");
        own.parentElement.insertBefore(host, own);
        window.__svgReviewProbe = function() {
          var target = host.querySelector("linearGradient");
          var attr = /#([^)'"]+)/.exec(borrowed.getAttribute("fill"))[1];
          var css = /#([^)'"]+)/.exec(getComputedStyle(borrowed).fill)[1];
          return { attribute: window.document.getElementById(attr) === target,
            css: window.document.getElementById(css) === target,
            local: localTarget.id === localId && window.document.getElementById(/#([^ )]+)/.exec(local.getAttribute("fill"))[1]) === localTarget };
        };`,
      expected: { attribute: true, css: true, local: true },
    },
    {
      name: "root attributes and root CSS retain the original mounted SVG target",
      external: false,
      content: `<svg><linearGradient id="paint"><stop stop-color="red"/></linearGradient><rect fill="url(#paint)"/></svg>`,
      script: `var target = document.querySelector("linearGradient");
        window.__svgReviewProbe = function() {
          var borrowed = window.document.querySelector(".root-borrowed");
          var attr = /#([^)'"]+)/.exec(borrowed.getAttribute("fill"))[1];
          var css = /#([^)'"]+)/.exec(getComputedStyle(borrowed).fill)[1];
          return { attribute: window.document.getElementById(attr) === target,
            css: window.document.getElementById(css) === target,
            rootId: window.document.querySelector(".outside-paint").id };
        };`,
      expected: { attribute: true, css: true, rootId: "paint" },
    },
    {
      name: "first native use of a resource",
      external: false,
      content: `<svg><clipPath id="late"/></svg>`,
      script: `var svg = document.querySelector("svg");
        var target = svg.querySelector("clipPath");
        var group = window.document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("clip-path", "url(#late)");
        svg.appendChild(group);
        window.__svgReviewProbe = function() {
          var reference = /#([^)'"]+)/.exec(group.getAttribute("clip-path"))[1];
          return { own: window.document.getElementById(reference) === target };
        };`,
      expected: { own: true },
    },
    {
      name: "first native use of a path",
      external: false,
      content: `<svg><path id="late-path"/></svg>`,
      script: `var svg = document.querySelector("svg");
        var target = svg.querySelector("path");
        var use = window.document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#late-path");
        svg.appendChild(use);
        window.__svgReviewProbe = function() {
          return { own: window.document.getElementById(use.getAttribute("href").slice(1)) === target };
        };`,
      expected: { own: true },
    },
    {
      name: "initial script native writes resolve within their already-namespaced instance",
      external: false,
      content: `<svg><clipPath id="clip"/><symbol id="symbol"/><g clip-path="url(#clip)"/><use href="#symbol"/></svg>`,
      script: `var svg = document.querySelector("svg");
        var clip = svg.querySelector("clipPath");
        var symbol = svg.querySelector("symbol");
        var captured = clip.id;
        svg.querySelector("g").setAttribute("clip-path", "url(#clip)");
        var use = window.document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#symbol");
        svg.appendChild(use);
        window.__svgReviewProbe = function() {
          var clipRef = /#([^)'"]+)/.exec(svg.querySelector("g").getAttribute("clip-path"))[1];
          return { clip: window.document.getElementById(clipRef) === clip,
            symbol: window.document.getElementById(use.getAttribute("href").slice(1)) === symbol,
            stable: captured === clip.id };
        };`,
      expected: { clip: true, symbol: true, stable: true },
    },
    {
      name: "ID selectors follow actual renamed IDs and stop matching unrelated writes",
      external: false,
      content: `<style>clipPath[id="clip"] { color: red } #clip { opacity: .4 }</style><svg><clipPath id="clip"/><g clip-path="url(#clip)"/></svg>`,
      script: `var svg = document.querySelector("svg");
        var target = svg.querySelector("clipPath");
        window.__svgReviewProbe = function() {
          var result = { id: svg.querySelector("#clip") === target,
            attribute: svg.querySelector('[id="clip"]') === target,
            color: getComputedStyle(target).color, opacity: getComputedStyle(target).opacity };
          target.id = "unrelated";
          result.afterId = svg.querySelector("#clip") === null;
          result.afterAttribute = svg.querySelector('[id="clip"]') === null;
          result.afterColor = getComputedStyle(target).color;
          result.afterOpacity = getComputedStyle(target).opacity;
          return result;
        };`,
      expected: {
        id: true,
        attribute: true,
        color: "rgb(255, 0, 0)",
        opacity: "0.4",
        afterId: true,
        afterAttribute: true,
        afterColor: "rgb(0, 0, 0)",
        afterOpacity: "1",
      },
    },
    {
      name: "root ID rules keep every renamed definition when the first target keeps its ID",
      external: false,
      content: `<svg><clipPath id="clip"/><g clip-path="url(#clip)"/></svg><template id="child-template"><div data-composition-id="child"><svg><clipPath id="clip"/><g clip-path="url(#clip)"/></svg></div></template><div data-composition-id="child"></div>`,
      script: `window.__svgReviewProbe = function() {
        var definitions = [...window.document.querySelectorAll('clipPath:not([id="late"])')];
        return { count: String(definitions.length), colors: definitions.every(function(target) {
          return getComputedStyle(target).stroke === "rgb(0, 128, 0)";
        }) };
      };`,
      expected: { count: "3", colors: true },
    },
    {
      name: "replacement of a script-only inline host discards its empty staged queue",
      external: false,
      content: `<template id="empty-template"><script>window.__emptyStale = true;</script></template><div data-composition-id="empty"></div>`,
      script: `var host = document.querySelector('[data-composition-id="empty"]');
        host.innerHTML = '<span class="replacement">new</span>';
        window.__svgReviewProbe = function() { return { stale: window.__emptyStale === true, replaced: !!host.querySelector(".replacement") }; };`,
      expected: { stale: false, replaced: true },
    },
    {
      name: "initial inline discovery freezes the external owner's composition identity",
      external: false,
      content: `<style>.external-probe { color: red }</style><span class="external-probe">external</span><template id="grid-template"><div data-composition-id="grid"><span class="child-probe">child</span></div></template><div data-composition-id="grid"></div>`,
      script: `window.__svgReviewProbe = function() { return {
        scoped: !!document.querySelector(".external-probe"),
        color: getComputedStyle(document.querySelector(".external-probe")).color,
        child: !!document.querySelector(".child-probe") }; };`,
      expected: { scoped: true, color: "rgb(255, 0, 0)", child: true },
    },
    {
      name: "CSS id rules keep unchanged HTML and renamed SVG matches",
      external: false,
      content: `<style>#fx { color: rgb(255, 0, 0) }</style>
        <svg><filter id="fx"></filter><rect filter="url(#fx)"/></svg><div id="fx">text</div>`,
      script: `var svg = document.querySelector("svg");
        var html = document.querySelector("div#fx");
        window.__svgReviewProbe = function() {
          return { htmlColor: getComputedStyle(html).color,
            svgColor: getComputedStyle(svg.querySelector("filter")).color };
        };`,
      expected: { htmlColor: "rgb(255, 0, 0)", svgColor: "rgb(255, 0, 0)" },
    },
  ];

  it.each(
    svgReviewCases.flatMap((fixture) => [
      { ...fixture, compiled: false },
      ...([
        "CSS string continuations",
        "CSS token grammar and native errors",
        "Declared attribute namespace CSS",
        "HTML attribute name casing",
        "Multiline native reference attributes",
        "Escaped closing bracket attribute values",
        "external-only scripts retain authored SVG selectors",
        "authored native-reference attribute selectors work in scripts and CSS",
        "root attributes and root CSS retain the original mounted SVG target",
        "root ID rules keep every renamed definition when the first target keeps its ID",
        "ID selectors follow actual renamed IDs and stop matching unrelated writes",
      ].includes(fixture.name)
        ? [{ ...fixture, compiled: true }]
        : []),
    ]),
  )(
    "SVG revision: $name (compiled=$compiled)",
    async ({ content, script, external, expected, lateHtml = false, compiled }) => {
      const origin = "https://svg-review.test/";
      let gridPayload = `<script>${script}</script>`;
      if (external) gridPayload = '<script src="scene.js"></script>';
      if (lateHtml) gridPayload = "";
      const introHost =
        '<div id="intro" data-composition-id="intro" data-composition-src="intro.html"></div>';
      const gridHost =
        '<div id="grid" data-composition-id="grid" data-composition-src="grid.html"></div>';
      const hosts = lateHtml ? gridHost + introHost : introHost + gridHost;
      const assets: Record<string, { contentType: string; body: string | Buffer }> = {
        "runtime.js": { contentType: "text/javascript", body: readFileSync(RUNTIME_PATH) },
        "scene.js": { contentType: "text/javascript", body: script },
        "intro.html": {
          contentType: "text/html",
          body: `<template id="intro-template"><div data-composition-id="intro" data-duration="2"><svg><clipPath id="clip"/><clipPath id="late"/><path id="late-path"/><symbol id="symbol"/><g clip-path="url(#clip)"/><use href="#symbol"/></svg>${lateHtml ? `<script>${script}</script>` : ""}</div></template>`,
        },
        "grid.html": {
          contentType: "text/html",
          body: `<template id="grid-template"><div data-composition-id="grid" data-duration="2">${content}${gridPayload}</div></template>`,
        },
        "index.html": {
          contentType: "text/html",
          body: `<!doctype html><html><body><div data-composition-id="main" data-duration="2" data-width="320" data-height="180">${hosts}</div><style>.root-borrowed { fill: url(#paint) } #clip { stroke: green }</style><svg><linearGradient class="outside-paint" id="paint"><stop stop-color="blue"/></linearGradient><rect class="root-borrowed" fill="url(#paint)"/></svg><script src="runtime.js"></script></body></html>`,
        },
      };
      let compiledDirectory: string | undefined;
      if (compiled) {
        compiledDirectory = mkdtempSync(resolve(tmpdir(), "svg-alias-browser-"));
        for (const [path, asset] of Object.entries(assets))
          writeFileSync(resolve(compiledDirectory, path), asset.body);
        assets["index.html"]!.body = await bundleToSingleHtml(compiledDirectory);
      }
      const scenePage = await browser.newPage();
      try {
        await scenePage.setRequestInterception(true);
        let releaseGrid: ((release: () => void) => void) | undefined;
        const gridResponse = new Promise<() => void>((resolve) => {
          releaseGrid = resolve;
        });
        scenePage.on("request", (request) => {
          const path = request.url().slice(origin.length);
          const asset = assets[path];
          if (lateHtml && path === "grid.html") {
            releaseGrid!(() => {
              void request.respond(asset!);
            });
          } else if (asset) void request.respond(asset);
          else void request.continue();
        });
        await scenePage.goto(`${origin}index.html`);
        if (lateHtml) {
          await scenePage.waitForFunction(() => document.querySelector("#intro clipPath") !== null);
          (await gridResponse)();
        }
        await scenePage.waitForFunction(
          () => (window as unknown as { __renderReady?: boolean }).__renderReady === true,
        );
        const result = await scenePage.evaluate(() =>
          (window as unknown as { __svgReviewProbe: () => unknown }).__svgReviewProbe(),
        );
        expect(result).toEqual(expected);
      } finally {
        await scenePage.close();
        if (compiledDirectory) rmSync(compiledDirectory, { recursive: true, force: true });
      }
    },
    30_000,
  );

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

// This is a first-party protocol fixture, not the partner runner or its animation code.
const FILM_RUNNER_FIXTURE = `<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:black}</style>
<script>
addEventListener("message", async ({data}) => {
  if (data.type === "appifact-film:load") {
    parent.postMessage({type:"appifact-film:ready"}, "*");
  } else if (data.type === "appifact-film:frame") {
    await new Promise(resolve => setTimeout(resolve, 40));
    document.body.style.background = "rgb(" + Math.round(data.t * 40) + ",20,80)";
    parent.postMessage({type:"appifact-film:frame",seq:data.seq}, "*");
  }
});
parent.postMessage({type:"appifact-film:hello"}, "*");
</script>`;

function filmRuntimeFixture(runtime: string): string {
  const runnerLiteral = JSON.stringify(FILM_RUNNER_FIXTURE).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head>
<style>html,body{margin:0} iframe{display:block;border:0;width:320px;height:180px}</style>
<script>${runtime.replaceAll("</script", "<\\/script")}</script></head><body>
<div data-hf-id="hf-root" data-hf-root data-composition-id="root" data-start="0" data-duration="1" data-width="320" data-height="180" data-fps="30">
<div id="scene" data-hf-id="hf-scene" class="clip" data-composition-id="scene" data-start="0" data-duration="1" data-track-index="0">
<iframe id="stage" sandbox="allow-scripts" title="First-party protocol fixture"></iframe>
</div></div>
<script>
const bridge = window.__hyperframes.createFilmBridge({iframe:document.getElementById("stage"),runnerHtml:${runnerLiteral},load:{}});
window.__hyperframes.registerFrameSource({element:document.getElementById("scene"),ready:bridge.ready,render:async (time) => { await bridge.render(time); document.getElementById("scene").setAttribute("data-rendered-source-time",String(time)); },dispose:bridge.dispose,sourceRange:{start:3,duration:1,fps:30}});
</script></body></html>`;
}

describe("film bridge browser capture contract", () => {
  let browser: Browser;
  let html: string;
  beforeAll(async () => {
    html = filmRuntimeFixture(readFileSync(RUNTIME_PATH, "utf8"));
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });

  async function openFilm(source = html): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
    await page.setContent(source);
    await page.waitForFunction(
      () => window.__playerReady === true && window.__renderReady === true,
    );
    return page;
  }

  it("renders the executable wrapper after SDK edits, save and reopen", async () => {
    const composition = await openComposition(html);
    composition.setTiming("hf-scene", { start: 0.2, duration: 0.6 });
    composition.setAttribute("hf-scene", "data-playback-start", "0.1");
    composition.setAttribute("hf-scene", "data-playback-rate", "2");
    const reopened = await openComposition(composition.serialize());
    const page = await openFilm(reopened.serialize());
    const reference = await browser.newPage();
    try {
      await page.evaluate(() => window.__player?.renderSeek?.(0.4));
      await waitForPendingSeekCompletion(page);
      expect(
        Number(await page.$eval("#scene", (el) => el.getAttribute("data-rendered-source-time"))),
      ).toBeCloseTo(3.5, 10);
      await reference.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
      await reference.setContent("<style>html,body{margin:0;background:rgb(140,20,80)}</style>");
      expect(Buffer.from(await page.screenshot())).toEqual(
        Buffer.from(await reference.screenshot()),
      );
    } finally {
      await page.close();
      await reference.close();
    }
  });

  it("draws the first visible export frame at a near-frame start and stops at its snapped end", async () => {
    const composition = await openComposition(html);
    composition.setTiming("hf-root", { duration: 3 });
    composition.setTiming("hf-scene", { start: 1.00001, duration: 1 });
    const source = composition
      .serialize()
      .replace(
        "<head>",
        '<head><script>window.__HF_EXPORT_RENDER_SEEK_CONFIG={fps:30,fpsSource:"render-options"};</script>',
      );
    const page = await openFilm(source);
    const reference = await browser.newPage();
    await reference.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
    try {
      for (const [time, sourceTime] of [
        [1, 3],
        [59 / 30, 3 + 59 / 30 - 1.00001],
      ]) {
        await page.evaluate((t) => window.__player?.renderSeek?.(t), time);
        await waitForPendingSeekCompletion(page);
        expect(
          Number(await page.$eval("#scene", (el) => el.getAttribute("data-rendered-source-time"))),
        ).toBeCloseTo(sourceTime!, 10);
        await reference.setContent(
          `<style>html,body{margin:0;background:rgb(${Math.round(sourceTime! * 40)},20,80)}</style>`,
        );
        expect(Buffer.from(await page.screenshot())).toEqual(
          Buffer.from(await reference.screenshot()),
        );
      }
      const last = await page.$eval("#scene", (el) => el.getAttribute("data-rendered-source-time"));
      await page.evaluate(() => window.__player?.renderSeek?.(2));
      await waitForPendingSeekCompletion(page);
      expect(await page.$eval("#scene", (el) => el.getAttribute("data-rendered-source-time"))).toBe(
        last,
      );
      expect(
        await page.evaluate(() => ({
          duration: window.__player?.getDuration?.(),
          visibility: getComputedStyle(document.getElementById("scene")!).visibility,
          background: getComputedStyle(document.body).backgroundColor,
        })),
      ).toEqual({ duration: 3, visibility: "hidden", background: "rgba(0, 0, 0, 0)" });
      await reference.setContent("<style>html,body{margin:0;background:#121212}</style>");
      expect(Buffer.from(await page.screenshot())).toEqual(
        Buffer.from(await reference.screenshot()),
      );
    } finally {
      await page.close();
      await reference.close();
    }
  });

  it("captures the acknowledged frame for reverse, repeated and fresh-page seeks", async () => {
    const page = await openFilm();
    const reference = await browser.newPage();
    await reference.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const captures = new Map<number, Uint8Array>();
    try {
      for (const time of [0, 0.5, 0.2, 0.5, 0.9, 1, 0]) {
        await page.evaluate((t) => window.__player?.renderSeek?.(t), time);
        await waitForPendingSeekCompletion(page);
        const actual = await page.screenshot();
        const sourceTime = 3 + Math.min(time, 1 - 1 / 30);
        await reference.setContent(
          `<style>html,body{margin:0;background:rgb(${Math.round(sourceTime * 40)},20,80)}</style>`,
        );
        expect(Buffer.from(actual)).toEqual(Buffer.from(await reference.screenshot()));
        const previous = captures.get(time);
        if (previous) expect(Buffer.from(actual)).toEqual(Buffer.from(previous));
        captures.set(time, actual);
      }
      const fresh = await openFilm();
      try {
        await fresh.evaluate(() => window.__player?.renderSeek?.(0.5));
        await waitForPendingSeekCompletion(fresh);
        expect(Buffer.from(await fresh.screenshot())).toEqual(Buffer.from(captures.get(0.5)!));
      } finally {
        await fresh.close();
      }
      await page.evaluate(() => {
        const scene = document.getElementById("scene")!;
        scene.setAttribute("data-playback-start", "0.25");
        scene.setAttribute("data-playback-rate", "2");
        window.__player?.renderSeek?.(0.2);
      });
      await waitForPendingSeekCompletion(page);
      await reference.setContent("<style>html,body{margin:0;background:rgb(146,20,80)}</style>");
      expect(Buffer.from(await page.screenshot())).toEqual(
        Buffer.from(await reference.screenshot()),
      );
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await reference.close();
    }
  }, 30_000);
});

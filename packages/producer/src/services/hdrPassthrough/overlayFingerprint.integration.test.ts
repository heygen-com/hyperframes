// The in-page overlay fingerprint against a real Chrome page: every kind of change that paints
// must change it, and the page's own capture bookkeeping (mask residue, the video and its
// replacement frame, script text) must not. Needs Chrome: integration lane.

import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { collectOverlayPageFingerprint, type PageFingerprint } from "./overlayFingerprint.js";

const GSAP_PATH = resolve(
  import.meta.dirname,
  "../../../../core/node_modules/gsap/dist/gsap.min.js",
);

const PAGE = `<!doctype html>
<html>
<head>
  <style id="sheet">.caption { color: #fff; }</style>
  <style>@keyframes pulse { from { opacity: 1; } to { opacity: 0.5; } }</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="2">
    <video id="video" data-start="0" data-duration="2"></video>
    <img class="__render_frame__" id="__render_frame_video__" />
    <div id="cue" class="caption" data-start="0" data-duration="1"><span id="word">Hello</span></div>
    <div id="list" style="overflow: hidden; height: 20px"><div style="height: 200px">rows</div></div>
  </div>
  <script id="code">window.__ready = true;</script>
</body>
</html>`;

async function fingerprint(page: Page): Promise<PageFingerprint> {
  return page.evaluate(collectOverlayPageFingerprint, "video");
}

describe("collectOverlayPageFingerprint in Chrome", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    await page.setContent(PAGE);
  });

  /** Fingerprint before and after `change` runs in the page. */
  async function around(change: () => void): Promise<[PageFingerprint, PageFingerprint]> {
    const before = await fingerprint(page);
    await page.evaluate(change);
    return [before, await fingerprint(page)];
  }

  it("is stable for an unchanged page", async () => {
    const first = await fingerprint(page);
    expect(await fingerprint(page)).toEqual(first);
  });

  it.each<[string, () => void]>([
    [
      "a tiny inline style change",
      () => document.getElementById("cue")!.style.setProperty("opacity", "0.99"),
    ],
    [
      "a colour one level off",
      () => document.getElementById("word")!.style.setProperty("color", "#fefefe"),
    ],
    [
      "the runtime hiding a clip",
      () => document.getElementById("cue")!.style.setProperty("visibility", "hidden"),
    ],
    ["a text change", () => (document.getElementById("word")!.textContent = "Hellp")],
    ["an attribute change", () => document.getElementById("cue")!.setAttribute("data-state", "on")],
    ["a class change", () => document.getElementById("cue")!.classList.add("big")],
    [
      "a CSSOM rule inserted without touching the DOM",
      () =>
        (document.getElementById("sheet") as HTMLStyleElement).sheet!.insertRule(
          "#cue{opacity:.5}",
          1,
        ),
    ],
    ["element scroll", () => (document.getElementById("list")!.scrollTop = 7)],
    ["a removed overlay element", () => document.getElementById("word")!.remove()],
    [
      "a started CSS animation",
      () => {
        const cue = document.getElementById("cue")!;
        cue.style.setProperty("animation", "pulse 1s linear paused");
      },
    ],
  ])("changes on %s", async (_name, change) => {
    const [before, after] = await around(change);
    expect(after).not.toEqual(before);
  });

  it("changes as a CSS animation advances, with no DOM change", async () => {
    await page.evaluate(() => {
      document.getElementById("cue")!.style.setProperty("animation", "pulse 1s linear paused");
    });
    const [before, after] = await around(() => {
      for (const animation of document.getAnimations()) animation.currentTime = 400;
    });
    expect(after).not.toEqual(before);
  });

  it("changes when a tween writes a property the DOM does not reflect", async () => {
    await page.addScriptTag({ path: GSAP_PATH });
    await page.evaluate(() => {
      const w = window as unknown as {
        gsap: {
          timeline(vars: object): { to(t: object, v: object): unknown; seek(t: number): void };
        };
        __timelines: Record<string, unknown>;
        __meter: { level: number };
      };
      w.__meter = { level: 0 };
      const tl = w.gsap.timeline({ paused: true });
      tl.to(w.__meter, { level: 10, duration: 1, ease: "none" });
      w.__timelines = { main: tl };
    });
    const [before, after] = await around(() => {
      (
        window as unknown as { __timelines: { main: { seek(t: number): void } } }
      ).__timelines.main.seek(0.5);
    });
    expect(after).not.toEqual(before);
  });

  it.each<[string, () => void]>([
    [
      "mask residue (an empty style attribute)",
      () => {
        const cue = document.getElementById("cue")!;
        cue.style.setProperty("visibility", "hidden", "important");
        cue.style.removeProperty("visibility");
      },
    ],
    [
      "re-ordered inline declarations",
      () => {
        const list = document.getElementById("list")!;
        list.setAttribute("style", "height: 20px; overflow: hidden");
      },
    ],
    [
      "the passthrough video's per-frame writes",
      () => {
        const video = document.getElementById("video")!;
        video.style.setProperty("visibility", "hidden", "important");
        video.setAttribute("data-frame", "12");
      },
    ],
    [
      "a new replacement frame",
      () => {
        const img = document.getElementById("__render_frame_video__") as HTMLImageElement;
        img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
        img.style.visibility = "visible";
      },
    ],
    ["script text", () => (document.getElementById("code")!.textContent = "window.__ready = 1;")],
    ["a comment", () => document.body.appendChild(document.createComment("note"))],
  ])("ignores %s", async (_name, change) => {
    const [before, after] = await around(change);
    expect(after).toEqual(before);
  });
});

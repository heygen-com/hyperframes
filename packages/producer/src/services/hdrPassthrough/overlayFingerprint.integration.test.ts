// The in-page overlay fingerprint against a real Chrome page: every kind of change that paints
// must change it, and the page's own capture bookkeeping (mask residue, the video and its
// replacement frame, script text) must not. Needs Chrome: integration lane.

import { resolve } from "node:path";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { getCdpSession } from "@hyperframes/engine";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adoptElements, callIsolated, evaluateIsolated, handleIsolated } from "./isolatedWorld.js";
import {
  captureDomSnapshot,
  collectOverlayPageFingerprint,
  findBlindSpotsInSnapshot,
  findOwnClockElementsInSnapshot,
  type OverlayPageFingerprint,
  readOverlayFingerprint,
  BrowserClockError,
} from "./overlayFingerprint.js";

type PageFingerprint = string;

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

/** What the collector reads, where the page cannot reach (the isolated world). */
function collect(page: Page) {
  return evaluateIsolated(
    page as never,
    collectOverlayPageFingerprint,
    "video",
    MEDIA_RENDER_ID_ATTR,
    [],
  );
}

/** The fingerprint text. */
async function fingerprint(page: Page): Promise<PageFingerprint> {
  return (await collect(page)).text;
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

  // A GSAP `set()` of `scrollTop` on such an element starts a scroll the browser animates after
  // the probe read the old offset: the probe names it, and `readOverlayFingerprint` declines.
  it.each<[string, () => void, string]>([
    [
      "a stylesheet rule",
      () =>
        (document.getElementById("sheet") as HTMLStyleElement).sheet!.insertRule(
          "#list{scroll-behavior:smooth}",
          1,
        ),
      "<div#list>",
    ],
    [
      "an inline style",
      () => document.getElementById("list")!.style.setProperty("scroll-behavior", "smooth"),
      "<div#list>",
    ],
    [
      "the root (the viewport's scroll)",
      () => document.documentElement.style.setProperty("scroll-behavior", "smooth"),
      "<html>",
    ],
    [
      "an element in an open shadow root",
      () => {
        const host = document.getElementById("cue")!.attachShadow({ mode: "open" });
        host.innerHTML = '<div id="inner" style="scroll-behavior: smooth">x</div>';
      },
      "<div#inner>",
    ],
  ])("names a computed smooth scroll-behavior from %s", async (_name, change, element) => {
    expect((await collect(page)).smoothScrollers).toEqual([]);
    await page.evaluate(change);
    expect((await collect(page)).smoothScrollers).toEqual([element]);
  });

  it("throws BrowserClockError from the probe while any element scrolls smoothly", async () => {
    const probe = () => readOverlayFingerprint({ page } as never, "video", []);
    expect(await probe()).toMatch(/^[0-9a-f]{64}$/);
    await page.evaluate(() =>
      document.getElementById("list")!.style.setProperty("scroll-behavior", "smooth"),
    );
    await expect(probe()).rejects.toMatchObject({
      name: "BrowserClockError",
      reason: "overlay_unsupported",
    });
  });

  // A style change a seek makes starts a CSS transition that runs on the wall clock; the probe
  // right after it sees it running, however soon it ends.
  it("names a running CSS transition a style change started, and the probe declines", async () => {
    const probe = () => readOverlayFingerprint({ page } as never, "video", []);
    await page.evaluate(() => {
      const cue = document.getElementById("cue")!;
      cue.style.setProperty("transition", "opacity 0.2s linear");
      void getComputedStyle(cue).opacity;
    });
    expect((await collect(page)).runningAnimations).toEqual([]);
    expect(await probe()).toMatch(/^[0-9a-f]{64}$/);
    await page.evaluate(() => document.getElementById("cue")!.style.setProperty("opacity", "0.5"));
    expect((await collect(page)).runningAnimations).toEqual([
      "CSSTransition(opacity) on <div#cue>",
    ]);
    await expect(probe()).rejects.toBeInstanceOf(BrowserClockError);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    expect((await collect(page)).runningAnimations).toEqual([]);
  });

  it("passes a paused animation, which follows the seek", async () => {
    await page.evaluate(() =>
      document.getElementById("cue")!.style.setProperty("animation", "pulse 1s linear paused"),
    );
    expect((await collect(page)).runningAnimations).toEqual([]);
  });

  it("reads a smooth scroll's write as not yet applied, so the probe declines", async () => {
    const offsets = await page.evaluate(() => {
      const list = document.getElementById("list")!;
      list.style.setProperty("scroll-behavior", "smooth");
      list.scrollTop = 100;
      const read = list.scrollTop;
      return [read, list.scrollTop];
    });
    // Within the task that wrote it, the offset is still the old one; the browser moves it later.
    expect(offsets).toEqual([0, 0]);
    expect((await collect(page)).smoothScrollers).toEqual(["<div#list>"]);
    await page.waitForFunction(() => document.getElementById("list")!.scrollTop === 100);
  });

  it("reads snapping and scroll anchoring as soon as the write or layout happens", async () => {
    const offsets = await page.evaluate(() => {
      const rows = (n: number, height: number, style: string) =>
        Array.from({ length: n }, (_, i) => `<div style="height:${height}px;${style}">${i}</div>`);
      document
        .getElementById("root")!
        .insertAdjacentHTML(
          "beforeend",
          `<div id="snap" style="overflow:hidden;height:20px;scroll-snap-type:y mandatory">${rows(12, 15, "scroll-snap-align:start").join("")}</div>` +
            `<div id="anchor" style="overflow:hidden;height:20px">${rows(12, 40, "").join("")}</div>`,
        );
      const snap = document.getElementById("snap")!;
      snap.scrollTop = 50;
      const snapped = snap.scrollTop;
      const anchor = document.getElementById("anchor")!;
      anchor.scrollTop = 80;
      void anchor.offsetHeight;
      (anchor.firstElementChild as HTMLElement).style.height = "70px";
      return [snapped, anchor.scrollTop];
    });
    expect(offsets).toEqual([45, 110]);
    expect((await collect(page)).smoothScrollers).toEqual([]);
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

  // Paint state no attribute, text or style holds, which a builtin handed to an observer or a
  // listener can set with no page script running.
  it.each<[string, string, () => void]>([
    [
      "a popover opened",
      '<div id="pop" popover="manual">P</div>',
      () => document.getElementById("pop")!.showPopover(),
    ],
    [
      "a dialog shown modal instead of open",
      '<dialog id="dlg" open>D</dialog>',
      () => {
        const dialog = document.getElementById("dlg") as HTMLDialogElement;
        dialog.close();
        dialog.showModal();
      },
    ],
    [
      "the document selection",
      '<p id="para">selected</p>',
      () => getSelection()!.selectAllChildren(document.getElementById("para")!),
    ],
    [
      "a text control's selection",
      '<input id="field" value="text" />',
      () => (document.getElementById("field") as HTMLInputElement).setSelectionRange(1, 3),
    ],
    [
      "a custom highlight",
      '<style>::highlight(hf) { color: red; }</style><p id="para">lit</p>',
      () => {
        const range = new Range();
        range.selectNodeContents(document.getElementById("para")!);
        CSS.highlights.set("hf", new Highlight(range));
      },
    ],
    [
      "an option selected in a multiple select",
      '<select id="multi" multiple><option selected>a</option><option>b</option></select>',
      // selectedIndex stays 0: only the second option's own selectedness changes.
      () => ((document.getElementById("multi") as HTMLSelectElement).options[1]!.selected = true),
    ],
    [
      "a custom validity message",
      '<style>input:invalid { outline: 2px solid red; }</style><input id="field" />',
      () => (document.getElementById("field") as HTMLInputElement).setCustomValidity("no"),
    ],
    [
      "the URL fragment a :target rule paints",
      '<style>:target { color: red; }</style><p id="aim">aim</p>',
      () => history.replaceState(null, "", "#aim"),
    ],
    ["design mode", "", () => (document.designMode = "on")],
  ])("changes on %s", async (_name, markup, change) => {
    await page.evaluate((html) => {
      document.getElementById("root")!.insertAdjacentHTML("beforeend", html);
    }, markup);
    const [before, after] = await around(change);
    expect(after).not.toEqual(before);
  });

  it("changes on a custom state the page's CSS names", async () => {
    await page.evaluate(() => {
      customElements.define(
        "hf-stateful",
        class extends HTMLElement {
          constructor() {
            super();
            (window as unknown as { internals: ElementInternals }).internals =
              this.attachInternals();
          }
        },
      );
      document
        .getElementById("root")!
        .insertAdjacentHTML(
          "beforeend",
          "<style>hf-stateful:state(lit) { color: red; }</style><hf-stateful>s</hf-stateful>",
        );
    });
    const [before, after] = await around(() =>
      (window as unknown as { internals: ElementInternals }).internals.states.add("lit"),
    );
    expect(after).not.toEqual(before);
  });

  it("changes on a CSSOM rule inserted into an open shadow root's own sheet", async () => {
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "badge-host";
      document.getElementById("root")!.appendChild(host);
      host.attachShadow({ mode: "open" }).innerHTML =
        '<style id="inner-sheet">.b { opacity: 1; }</style><div class="b">badge</div>';
    });
    const [before, after] = await around(() => {
      const shadow = document.getElementById("badge-host")!.shadowRoot!;
      (shadow.getElementById("inner-sheet") as HTMLStyleElement).sheet!.insertRule(
        ".b{opacity:.5}",
        1,
      );
    });
    expect(after).not.toEqual(before);
  });

  it("changes when focus moves", async () => {
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "field";
      document.getElementById("cue")!.appendChild(input);
      input.focus();
    });
    const [before, after] = await around(() => document.getElementById("field")!.blur());
    expect(after).not.toEqual(before);
  });

  it("changes on a CSSOM rule inserted into an @import-ed sheet", async () => {
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const style = document.createElement("style");
          style.textContent = '@import url("data:text/css,.caption%7Bopacity:1%7D");';
          style.addEventListener("load", () => done());
          document.head.appendChild(style);
        }),
    );
    const [before, after] = await around(() => {
      const style = document.head.lastElementChild as HTMLStyleElement;
      const rule = style.sheet!.cssRules[0] as CSSImportRule;
      rule.styleSheet!.insertRule(".caption{opacity:.5}", 1);
    });
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

  it("changes as an animation inside an open shadow root advances", async () => {
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "anim-host";
      document.getElementById("root")!.appendChild(host);
      host.attachShadow({ mode: "open" }).innerHTML =
        "<style>@keyframes p { from { opacity: 1 } to { opacity: 0 } } div { animation: p 1s linear paused; }</style><div>x</div>";
    });
    const [before, after] = await around(() => {
      for (const animation of document.getElementById("anim-host")!.shadowRoot!.getAnimations()) {
        animation.currentTime = 400;
      }
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
      };
      const tl = w.gsap.timeline({ paused: true });
      tl.to("#list", { scrollTop: 10, duration: 1, ease: "none" });
      w.__timelines = { main: tl };
    });
    // The target and its tween's keys, handed over as `seekReachable.ts` finds them.
    // A main-world handle from the passthrough's own session, as `seekReachable.ts` reads them.
    const client = await getCdpSession(page as never);
    const { result: list } = await client.send("Runtime.evaluate", {
      expression: 'document.getElementById("list")',
    });
    const [adopted] = await adoptElements(page as never, [list.objectId as string]);
    const targets = await handleIsolated(page as never, (...pairs: unknown[]) => pairs, [
      { objectId: adopted as string },
      { value: ["scrollTop"] },
    ] as never);
    const read = async () =>
      (
        await callIsolated<OverlayPageFingerprint>(
          page as never,
          collectOverlayPageFingerprint as never,
          [{ value: "video" }, { value: MEDIA_RENDER_ID_ATTR }, { objectId: targets }],
        )
      ).text;
    const before = await read();
    await page.evaluate(() => {
      (
        window as unknown as { __timelines: { main: { seek(t: number): void } } }
      ).__timelines.main.seek(0.5);
    });
    const after = await read();
    expect(after).not.toEqual(before);
    expect(after).toContain("@tween scrollTop=");
  });

  // The page replaces the builtins an in-page collector would call with constant natives; the
  // isolated world's own are untouched, so the fingerprint still follows the DOM.
  it("changes with the DOM when the page replaced the builtins a collector would call", async () => {
    await page.evaluate(() => {
      const constant = String.bind(null, "x");
      JSON.stringify = constant as typeof JSON.stringify;
      Array.from = Array.of.bind(Array) as typeof Array.from;
      TextEncoder.prototype.encode = Uint8Array.of.bind(Uint8Array) as never;
      if (typeof SubtleCrypto !== "undefined") {
        SubtleCrypto.prototype.digest = Promise.resolve.bind(Promise, new ArrayBuffer(32)) as never;
      }
      Element.prototype.matches = Boolean.bind(null, false) as never;
      Object.getOwnPropertyNames = Array.of.bind(Array) as never;
    });
    const [before, after] = await around(() => {
      document.getElementById("word")!.textContent = "changed";
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

// Content page script cannot read: a closed shadow root, a document inside an <object> /
// <embed> / frame. The fingerprint cannot change when it changes, so the passthrough declines
// it; the DevTools DOM snapshot sees it.
describe("findFingerprintBlindSpots in Chrome", () => {
  let browser: Browser;
  let page: Page;
  const SVG = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect id="r" width="8" height="8"/></svg>',
  );

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

  const blindSpots = async () => findBlindSpotsInSnapshot(await captureDomSnapshot(page as never));

  it("finds nothing on a page script can read, open shadow roots and UA controls included", async () => {
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.getElementById("root")!.appendChild(host);
      host.attachShadow({ mode: "open" }).innerHTML = "<span>open</span>";
      const input = document.createElement("input");
      input.type = "range";
      document.getElementById("root")!.appendChild(input);
    });
    expect(await blindSpots()).toBeNull();
  });

  it("finds a closed shadow root, which the fingerprint walk cannot enter", async () => {
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.getElementById("root")!.appendChild(host);
      host.attachShadow({ mode: "closed" }).innerHTML = '<div style="opacity:0">badge</div>';
    });
    expect(
      await page.evaluate(() => document.querySelector("#root > div:last-child")!.shadowRoot),
    ).toBeNull();
    expect(await blindSpots()).toBe("1 closed shadow root(s)");
  });

  it("finds a declarative closed shadow root", async () => {
    await page.setContent(
      '<div id="host"><template shadowrootmode="closed"><b>closed</b></template></div>',
    );
    expect(await blindSpots()).toBe("1 closed shadow root(s)");
  });

  it("finds an <object> document", async () => {
    await page.evaluate(
      (svg) =>
        new Promise<void>((done) => {
          const object = document.createElement("object");
          object.type = "image/svg+xml";
          object.data = `data:image/svg+xml,${svg}`;
          object.addEventListener("load", () => done());
          object.addEventListener("error", () => done());
          document.getElementById("root")!.appendChild(object);
        }),
      SVG,
    );
    expect(await blindSpots()).toBe("1 <object>");
  }, 30_000);

  it("finds an iframe inside a shadow root", async () => {
    await page.setContent('<div id="host"></div>');
    await page.evaluate(() => {
      const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
      shadow.innerHTML = '<iframe srcdoc="<p>inner</p>"></iframe>';
    });
    // The engine's own iframe gate queries the light DOM only.
    expect(await page.evaluate(() => document.querySelector("iframe"))).toBeNull();
    expect(await blindSpots()).toBe("1 <iframe>");
  }, 30_000);
});

// Content that paints on its own clock or from state the runtime drives: user-agent shadow trees
// that animate, audio controls the runtime's seeks move, a second video the composition's video
// list does not hold. The DOM snapshot reads every shadow tree.
describe("inspectDomSnapshot in Chrome", () => {
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

  const add = (html: string, shadow = false) =>
    page.evaluate(
      (markup, inShadow) => {
        const root = document.getElementById("root")!;
        if (!inShadow) return root.insertAdjacentHTML("beforeend", markup);
        const host = document.createElement("div");
        root.appendChild(host);
        host.attachShadow({ mode: "open" }).innerHTML = markup;
      },
      html,
      shadow,
    );
  const inspect = async () => {
    const snapshot = await captureDomSnapshot(page as never);
    const blind = findBlindSpotsInSnapshot(snapshot);
    return blind
      ? { reason: "overlay_unreadable", detail: blind }
      : findOwnClockElementsInSnapshot(snapshot, "video");
  };

  it("finds nothing besides the source, silent audio and a determinate progress bar", async () => {
    await add(
      '<audio src="voice.m4a"></audio><progress value="0.5"></progress><meter value="0.5"></meter>',
    );
    expect(await inspect()).toBeNull();
  });

  it.each<[string, string, boolean, { reason: string; detail: string }]>([
    [
      "a marquee",
      "<marquee>m</marquee>",
      false,
      { reason: "overlay_non_gsap_animation", detail: "1 <marquee>" },
    ],
    [
      "an indeterminate progress bar in a shadow root",
      "<progress></progress>",
      true,
      { reason: "overlay_non_gsap_animation", detail: "1 indeterminate <progress>" },
    ],
    [
      "audio controls",
      '<audio controls src="voice.m4a"></audio>',
      false,
      { reason: "overlay_non_gsap_animation", detail: "1 <audio controls>" },
    ],
    [
      "a video in a shadow root",
      "<video muted autoplay></video>",
      true,
      { reason: "video_count", detail: "1 <video> besides the source" },
    ],
  ])("finds %s", async (_label, markup, shadow, finding) => {
    await add(markup, shadow);
    expect(await inspect()).toEqual(finding);
  });

  it("reports unreadable content first", async () => {
    await add("<marquee>m</marquee><iframe></iframe>");
    expect(await inspect()).toEqual({ reason: "overlay_unreadable", detail: "1 <iframe>" });
  });
});

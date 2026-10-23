import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { MEDIA_RENDER_ID_ATTR, renderFrameIdForRenderId } from "@hyperframes/core";
import { injectVideoFramesBatch } from "@hyperframes/engine";
import { classifyLayeredFrame } from "./layeredFrameState.js";
import { readLayeredFrameState, readLayeredFrame } from "./layeredFrame.js";
import { createLayeredChunkObserver } from "./layeredEligibility.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

async function fixture(css = "", content = "") {
  await page.setContent(`<!doctype html><style>
    body { margin:0; } [data-composition-id] { position:relative; width:320px; height:180px; overflow:hidden; }
    video,img { position:absolute; left:10px; top:20px; width:160px; height:90px; z-index:0; object-fit:fill; }
    video { visibility:hidden; } img { border-radius:8px; opacity:0.75; }
    #caption { position:absolute; z-index:1; left:10px; top:10px; color:white; }
    ${css}</style><div data-composition-id="main"><video id="clip" ${MEDIA_RENDER_ID_ATTR}="render-clip"></video>
    <img id="${renderFrameIdForRenderId("render-clip")}" src="${PNG}"><div id="caption">Caption</div>${content}</div>`);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
}

describe("browser layered frame facts", () => {
  it("accepts a flat radius/opacity/rect-clip composition without changing its pixels or DOM", async () => {
    await fixture();
    const beforeHtml = await page.content();
    const beforePixels = await page.screenshot();
    expect(await readLayeredFrame(page)).toMatchObject({ kind: "candidate", videoCount: 1 });
    expect(await page.content()).toBe(beforeHtml);
    expect(Buffer.from(await page.screenshot()).equals(Buffer.from(beforePixels))).toBe(true);
  });

  it("accepts facts produced by the real frame injector and reuses the pure rule", async () => {
    await fixture();
    await page.evaluate(() => {
      document.querySelector("img")!.remove();
      document.querySelector("video")!.id = "render-clip";
    });
    expect(await injectVideoFramesBatch(page, [{ videoId: "render-clip", dataUri: PNG }])).toEqual([
      "render-clip",
    ]);
    const facts = await readLayeredFrameState(page);
    expect(classifyLayeredFrame(facts)).toMatchObject({ kind: "candidate", videoCount: 1 });
    expect(classifyLayeredFrame(structuredClone(facts))).toEqual(classifyLayeredFrame(facts));
  });

  it.each([
    ["[data-composition-id] {opacity:0.5}", "unsupported_stacking"],
    ["[data-composition-id] {transform:translateX(1px)}", "unsupported_stacking"],
    ["[data-composition-id] {isolation:isolate} #caption {z-index:auto}", "unsupported_stacking"],
    ["#caption {position:static}", "unsupported_stacking"],
    ["[data-composition-id] {position:static}", "unsupported_stacking"],
    ["#caption {z-index:-1}", "unsupported_stacking"],
    ["img {transform:rotate(5deg)}", "unsupported_geometry"],
    ["img {scale:2}", "unsupported_geometry"],
    ["img {border-radius:50%}", "unsupported_geometry"],
    ["img {object-fit:cover}", "unsupported_geometry"],
    ["img {filter:blur(1px)}", "unsupported_geometry"],
    ["img {clip-path:circle(40%)}", "unsupported_geometry"],
    ["img {box-shadow:0 0 5px black}", "video_decoration"],
    ["img {padding:1px}", "video_decoration"],
    ["body { overflow:hidden; border:1px solid red }", "unsupported_stacking"],
    ["img {border:1px solid red}", "video_decoration"],
    ["#caption {mix-blend-mode:multiply}", "unsupported_effect"],
    ["#caption {backdrop-filter:blur(1px)}", "unsupported_effect"],
  ])("refuses unsupported computed CSS: %s", async (css, reason) => {
    await fixture(css);
    expect(await readLayeredFrame(page)).toEqual({ kind: "fallback", reason });
  });

  it("refuses nested videos instead of flattening an implicit stacking context", async () => {
    await fixture();
    await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.style.opacity = "0.5";
      const video = document.querySelector("video")!;
      video.before(wrapper);
      wrapper.append(video);
    });
    expect(await readLayeredFrame(page)).toEqual({ kind: "fallback", reason: "nested_video" });
  });

  it.each([
    "<canvas></canvas>",
    "<iframe></iframe>",
    "<svg></svg>",
    "<dialog></dialog>",
    "<custom-paint></custom-paint>",
  ])("refuses an unmodeled paint surface %s", async (content) => {
    await fixture("", content);
    expect(await readLayeredFrame(page)).toEqual({
      kind: "fallback",
      reason: "unsupported_effect",
    });
  });

  it("uses render identity rather than the author ID to find the injected frame", async () => {
    await fixture();
    await page.evaluate(() => document.querySelector("img")!.remove());
    expect(await readLayeredFrame(page)).toEqual({
      kind: "fallback",
      reason: "missing_video_frame",
    });
  });

  it("records actual middle-frame CSS through the wrapped injection hook", async () => {
    await fixture();
    const observer = createLayeredChunkObserver({ startFrame: 0, endFrame: 3 }, 25);
    const hook = observer.wrap(async (target, time) => {
      await target.evaluate((t) => {
        document.querySelector("img")!.style.transform = t === 0.04 ? "rotate(5deg)" : "none";
      }, time);
    });
    if (hook === null) throw new Error("Expected video hook");
    for (const time of [0, 0.04, 0.08]) await hook(page, time);
    expect(observer.decision()).toEqual({
      kind: "fallback",
      reason: "unsupported_geometry",
      frameIndex: 1,
    });
  });

  it("observes all captured frames after the injector and forwards held video time", async () => {
    await fixture();
    const calls: number[][] = [];
    const observer = createLayeredChunkObserver({ startFrame: 10, endFrame: 13 }, 25);
    const hook = observer.wrap(async (_page, time, held) => {
      calls.push([time, held ?? -1]);
    });
    if (hook === null) throw new Error("Expected video hook");
    for (const frame of [10, 12, 11]) await hook(page, frame / 25, 0);
    expect(calls).toEqual([
      [0.4, 0],
      [0.48, 0],
      [0.44, 0],
    ]);
    expect(observer.decision()).toEqual({ kind: "eligible", frames: 3, videoCount: 1 });
  });

  it("accepts the runtime viewport clip and preserves zero opacity", async () => {
    await fixture("html,body {overflow:hidden} img {opacity:0}");
    expect(await readLayeredFrame(page)).toMatchObject({ kind: "candidate" });
    const facts = await readLayeredFrameState(page);
    if (facts.kind !== "observed") throw new Error("Expected observed frame");
    expect(facts.videos[0]?.proxy?.opacity).toBe("0");
  });

  it("refuses scenes beyond the bounded observation budget", async () => {
    await fixture();
    await page.evaluate(() => {
      for (let index = 0; index < 513; index++)
        document.querySelector("[data-composition-id]")!.append(document.createElement("div"));
    });
    expect(await readLayeredFrame(page)).toEqual({ kind: "fallback", reason: "scene_complexity" });
  });

  it("does not certify fractional frame samples as complete integer frames", async () => {
    await fixture();
    const observer = createLayeredChunkObserver({ startFrame: 0, endFrame: 1 }, 25);
    const hook = observer.wrap(async () => {});
    if (hook === null) throw new Error("Expected video hook");
    await hook(page, 0.01);
    expect(observer.decision()).toEqual({
      kind: "fallback",
      reason: "unsupported_sampling",
      frameIndex: 0,
    });
  });

  it("falls back on the infinite CSS transform that still screenshots successfully", async () => {
    await fixture(
      "",
      '<div style="position:absolute;z-index:2;--progress:0;transform:scale(calc(1 / var(--progress)))">bad transform</div>',
    );
    const before = Buffer.from(await page.screenshot());
    const observer = createLayeredChunkObserver({ startFrame: 0, endFrame: 1 }, 25);
    const hook = observer.wrap(async () => {});
    if (hook === null) throw new Error("Expected video hook");
    await expect(readLayeredFrame(page)).rejects.toThrow("DOMMatrix");
    await hook(page, 0);
    expect(observer.decision()).toEqual({
      kind: "fallback",
      reason: "observation_error",
      frameIndex: 0,
    });
    expect(Buffer.from(await page.screenshot()).equals(before)).toBe(true);
  });

  it("propagates seek completion failure outside the observation boundary", async () => {
    await fixture();
    await page.evaluate(() =>
      Object.defineProperty(window, "__hfWaitForSeekCompletion", {
        configurable: true,
        value: async () => {
          throw new Error("seek failed");
        },
      }),
    );
    try {
      const observer = createLayeredChunkObserver({ startFrame: 0, endFrame: 1 }, 25);
      const hook = observer.wrap(async () => {});
      if (hook === null) throw new Error("Expected video hook");
      await expect(hook(page, 0)).rejects.toThrow("seek failed");
      expect(observer.decision()).toEqual({
        kind: "fallback",
        reason: "incomplete_frames",
        frameIndex: null,
      });
    } finally {
      await page.evaluate(() => Reflect.deleteProperty(window, "__hfWaitForSeekCompletion"));
    }
  });

  it("propagates injector failure without claiming eligibility", async () => {
    await fixture();
    const observer = createLayeredChunkObserver({ startFrame: 0, endFrame: 1 }, 25);
    const hook = observer.wrap(async () => {
      throw new Error("inject failed");
    });
    if (hook === null) throw new Error("Expected video hook");
    await expect(hook(page, 0)).rejects.toThrow("inject failed");
    expect(observer.decision()).toEqual({
      kind: "fallback",
      reason: "incomplete_frames",
      frameIndex: null,
    });
  });
});

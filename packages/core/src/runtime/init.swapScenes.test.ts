import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular, installAuthoredMediaCapture } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { resetRuntimeDataForTests } from "./runtimeData";
import { WebAudioTransport } from "./webAudioTransport";
import { probeAndCacheElementVolume } from "./mediaVolumeEnvelope.js";
import { wrapScopedCompositionScript } from "../compiler/compositionScoping";
import { AFTER_FONTS_SCRIPT_TYPE } from "../compiler/scriptRuns";

vi.mock("./mediaVolumeEnvelope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mediaVolumeEnvelope.js")>();
  return { ...actual, probeAndCacheElementVolume: vi.fn(actual.probeAndCacheElementVolume) };
});
// jsdom has no WebGL, so no element ever gets graded: stand in for the grading runtime's answer.
vi.mock("./colorGrading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./colorGrading")>();
  return {
    ...actual,
    createColorGradingRuntime: (...args: Parameters<typeof actual.createColorGradingRuntime>) => ({
      ...actual.createColorGradingRuntime(...args),
      isGraded: (el: Element) => el.hasAttribute("data-color-grading"),
    }),
  };
});

// The library itself, the repo's vendored 3.15.0, for what a stand-in would only assume.
const vendoredGsap = () =>
  join(
    dirname(expect.getState().testPath!),
    "../../../../skills/music-to-video/references/motion-primitives/assets/gsap.min.js",
  );
type RealGsap = {
  ticker: { sleep: () => void };
  getProperty: (target: Element, property: string) => unknown;
};

type Tl = RuntimeTimelineLike & { kill: ReturnType<typeof vi.fn>; label: string };

function tl(label: string, duration = 2): Tl {
  const s = { time: 0, paused: true };
  return {
    label,
    play: () => void (s.paused = false),
    pause: () => void (s.paused = true),
    seek: (t?: number) => (t !== undefined && (s.time = t), s.time),
    totalTime: (t?: number) => (t !== undefined && (s.time = t), s.time),
    time: () => s.time,
    duration: () => duration,
    add: () => {},
    paused: (v?: boolean) => (typeof v === "boolean" && (s.paused = v), s.paused),
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
    kill: vi.fn(),
  } as unknown as Tl;
}

function trackingRoot() {
  const children: Array<{ child: unknown; at: number | undefined }> = [];
  const root = tl("root", 6) as Tl & { remove: (c: unknown) => void };
  root.add = ((child: unknown, at?: number) => void children.push({ child, at })) as Tl["add"];
  root.getChildren = (() => children.map((c) => c.child)) as Tl["getChildren"];
  root.remove = (child) => {
    const i = children.findIndex((c) => c.child === child);
    if (i >= 0) children.splice(i, 1);
  };
  return { root, children };
}

// A scene script in a real preview registers its timeline; here it names one from `made`.
const made: Record<string, Tl> = {};
// jsdom also runs it in its own global, where the test's objects do not exist: skip there.
const sceneScript = (id: string, label: string) =>
  `if (window.__made) window.__timelines[${JSON.stringify(id)}] = window.__made[${JSON.stringify(label)}];`;

interface Scene {
  id: string;
  start: number;
  body: string;
  css: string;
  label: string;
  hash: string;
  extraAttrs?: string;
  script?: string;
}

function preview(scenes: Scene[], shared = "s1", sharedMarkup = "") {
  const manifest = JSON.stringify({
    shared,
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s.hash])),
  }).replace(/"/g, "&quot;");
  const head =
    `<meta name="hf-scene-parts" content="${manifest}"><style>.shared{}</style>` +
    scenes.map((s) => `<style data-hf-scene="${s.id}">${s.css}</style>`).join("");
  const body =
    `<div data-composition-id="main" data-root="true" data-start="0" data-duration="6">${sharedMarkup}` +
    scenes
      .map(
        (s) =>
          `<div data-composition-id="${s.id}" data-hf-scene="${s.id}" data-start="${s.start}" data-duration="2"${s.extraAttrs ?? ""}>${s.body}</div>`,
      )
      .join("") +
    `</div>` +
    scenes
      .map(
        (s) =>
          `<script type="${AFTER_FONTS_SCRIPT_TYPE}" data-hf-scene="${s.id}">${sceneScript(s.id, s.label)}${s.script ?? ""}</script>`,
      )
      .join("");
  return {
    head,
    body,
    html: `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
  };
}

const A1: Scene = {
  id: "a",
  start: 1,
  body: "<p>A one</p>",
  css: ".a{color:red}",
  label: "a1",
  hash: "ha1",
};
const B: Scene = {
  id: "b",
  start: 3,
  body: "<p>B</p>",
  css: ".b{color:blue}",
  label: "b",
  hash: "hb",
};
const A2: Scene = { ...A1, body: "<p>A two</p>", css: ".a{color:green}", label: "a2", hash: "ha2" };

function mount(scenes: Scene[], root: Tl, editHead = (head: string) => head) {
  const { head, body } = preview(scenes);
  document.head.innerHTML = editHead(head);
  document.body.innerHTML = body;
  window.__timelines = { main: root };
  for (const s of scenes) window.__timelines[s.id] = made[s.label];
  // Run each scene script the swap puts in place, as a browser runs a created script.
  const replaceWith = Element.prototype.replaceWith;
  vi.spyOn(Element.prototype, "replaceWith").mockImplementation(function (this: Element, ...nodes) {
    replaceWith.apply(this, nodes);
    for (const node of nodes) {
      if (node instanceof HTMLScriptElement && node.hasAttribute("data-hf-scene"))
        new Function(node.textContent ?? "")();
    }
  });
}

function boot(scenes: Scene[], root: Tl, editHead = (head: string) => head) {
  mount(scenes, root, editHead);
  initSandboxRuntimeModular();
}

const tick = () => new Promise<void>((r) => window.setTimeout(r, 0));
const sceneHost = (id: string) =>
  document.querySelector(`[data-hf-scene="${id}"]:not(style):not(script)`)!;
const scoped = window as unknown as {
  __hfVariablesByComp?: Record<string, Record<string, unknown>>;
};
const quietMedia = () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
};
const proxyHostile = () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("x", { status: 206 }));
  window.__HF_MEDIA_CODEC_MAP__ = {
    "/clip.mov": { codecName: "prores", browserHostile: true, representativeMime: null },
  };
  return new URL("clip.mov?hf-proxy=h264", document.baseURI).href;
};
const cssText = () =>
  [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("");

// Boots A1 and B, then starts swapping in a captioned A whose caption overrides have not arrived.
async function bootWithPendingCaptions(signal?: AbortSignal, arrange = () => {}, others = [B]) {
  const { root } = trackingRoot();
  (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
  let answer: (r: Response) => void = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise<Response>((resolve) => (answer = resolve)),
  );
  boot([A1, ...others], root);
  await tick();
  arrange();
  const before = document.documentElement.innerHTML;
  const captions: Scene = { ...A2, body: '<div class="caption-group"><span>w</span></div>' };
  const swap = window.__hfSwapScenes!(preview([captions, ...others]).html, signal);
  return { swap, before, answer: (r: Response) => answer(r) };
}

describe("__hfSwapScenes", () => {
  beforeEach(() => {
    resetRuntimeDataForTests();
    (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (v: string) => v;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => (
      cb(0), 1
    )) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    for (const k of Object.keys(made)) delete made[k];
    for (const label of ["a1", "a2", "b", "n1", "n2"]) made[label] = tl(label);
    (window as unknown as { __made: typeof made }).__made = made;
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "gsap");
    window.__hfRuntimeTeardown?.();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete scoped.__hfVariablesByComp;
    delete window.__HF_MEDIA_CODEC_MAP__;
    delete window.__hfSceneAnimations;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("swaps only the edited scene: its DOM, style and timeline, keeping the time and the other scene", async () => {
    const { root, children } = trackingRoot();
    boot([A1, B], root);
    await tick();
    window.__player?.renderSeek(2);
    const bHost = document.querySelector('[data-hf-scene="b"]:not(style):not(script)');

    await window.__hfSwapScenes!(preview([A2, B]).html);

    const aHost = document.querySelector('[data-hf-scene="a"]:not(style):not(script)');
    expect(aHost?.textContent).toBe("A two");
    expect(document.querySelector('[data-hf-scene="b"]:not(style):not(script)')).toBe(bHost);
    expect(cssText()).toContain(".a{color:green}");
    expect(cssText()).not.toContain(".a{color:red}");
    expect(cssText()).toContain(".b{color:blue}");
    expect(made.a1!.kill).toHaveBeenCalled();
    expect(made.b!.kill).not.toHaveBeenCalled();
    expect(children).toContainEqual({ child: made.a2, at: 1 });
    expect(children.map((c) => c.child)).not.toContain(made.a1);
    expect(window.__player?.getTime()).toBe(2);
    expect(made.a2!.time()).toBe(1);
    const meta =
      document.querySelector('meta[name="hf-scene-parts"]')?.getAttribute("content") ?? "";
    expect(JSON.parse(meta).scenes.a).toBe("ha2");
  });

  it("runs the swapped scene's script only once web fonts are ready", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    let fontsLoaded = () => {};
    const ready = new Promise<void>((resolve) => (fontsLoaded = resolve));
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    try {
      const swap = window.__hfSwapScenes!(preview([A2, B]).html);
      for (let i = 0; i < 5; i++) await tick();
      expect(window.__timelines.a).not.toBe(made.a2);

      fontsLoaded();
      await swap;
      expect(window.__timelines.a).toBe(made.a2);
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
  });

  it("rejects without touching the film when anything outside the scenes changed", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    const before = document.body.innerHTML;
    await expect(window.__hfSwapScenes!(preview([A2, B], "s2").html)).rejects.toThrow(
      "outside its scenes",
    );
    expect(document.body.innerHTML).toBe(before);
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("rejects when a scene was added or removed, or when nothing changed", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    await expect(window.__hfSwapScenes!(preview([A1]).html)).rejects.toThrow("added or removed");
    await expect(window.__hfSwapScenes!(preview([A1, B]).html)).rejects.toThrow("no scene changed");
    await expect(window.__hfSwapScenes!("<html><body></body></html>")).rejects.toThrow(
      "no scene manifest",
    );
  });

  it("rejects a duplicated scene, whose script also registers under its shared original id", async () => {
    const { root } = trackingRoot();
    const dup = { ...A1, extraAttrs: ' data-hf-original-composition-id="orig"' };
    boot([dup, B], root);
    await tick();
    await expect(
      window.__hfSwapScenes!(preview([{ ...A2, extraAttrs: dup.extraAttrs }, B]).html),
    ).rejects.toThrow("cannot be swapped");
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("drops the timelines of compositions nested inside the swapped scene", async () => {
    const { root } = trackingRoot();
    const withNested = (s: Scene, n: string): Scene => ({
      ...s,
      body: `${s.body}<div data-composition-id="n"><i>${n}</i></div>`,
    });
    boot([withNested(A1, "n1"), B], root);
    window.__timelines!.n = made.n1;
    await tick();
    await window.__hfSwapScenes!(preview([withNested(A2, "n2"), B]).html);
    expect(made.n1!.kill).toHaveBeenCalled();
    expect(window.__timelines!.n).toBeUndefined();
  });

  it("stops and strips the replaced scene's media, <source> children included", async () => {
    const { root } = trackingRoot();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const video = (text: string) => ({
      ...A1,
      body: `<video title="${text}"><source src="https://example.com/a.mp4"></video><p>${text}</p>`,
    });
    boot([video("one"), B], root);
    await tick();
    const old = document.querySelector("video")!;
    await window.__hfSwapScenes!(preview([{ ...video("two"), hash: "hv2" }, B]).html);
    expect(document.querySelector("video")).not.toBe(old);
    expect(old.querySelector("source")).toBeNull();
    expect(load).toHaveBeenCalled();
  });

  it("re-applies caption overrides only when a swapped scene has captions", async () => {
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    const captions: Scene = { ...B, body: '<div class="caption-group"><span>w</span></div>' };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("null", { status: 404 }));
    boot([A1, captions], root);
    await tick();
    const captionFetches = () =>
      fetchSpy.mock.calls.filter(([url]) => String(url).includes("caption-overrides")).length;
    const atBoot = captionFetches();
    await window.__hfSwapScenes!(preview([A2, captions]).html);
    expect(captionFetches()).toBe(atBoot);
    await window.__hfSwapScenes!(
      preview([A2, { ...captions, body: captions.body + "<b>x</b>", hash: "hc2" }]).html,
    );
    expect(captionFetches()).toBe(atBoot + 1);
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("rewinds a swapped caption scene's timeline before rewriting its colour tweens", async () => {
    const { root } = trackingRoot();
    const order: string[] = [];
    const tween = {
      vars: { color: "#dim" },
      startTime: () => 0,
      invalidate: () => void order.push("rewrite"),
    };
    (window as unknown as { gsap: unknown }).gsap = { set: () => {}, getTweensOf: () => [tween] };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json([{ wordIndex: 0, dimColor: "#111", activeColor: "#eee" }]),
    );
    const captions = (label: string, hash: string): Scene => ({
      ...B,
      label,
      hash,
      body: '<div class="caption-group"><span>w</span></div>',
    });
    boot([A1, captions("b", "hb")], root);
    for (let i = 0; i < 5; i++) await tick();
    order.length = 0;
    // The playhead is past the scene, so its new timeline has already rendered at its end.
    made.n1!.totalTime(2);
    const rewind = made.n1!.totalTime.bind(made.n1);
    made.n1!.totalTime = ((t?: number) => (
      t === 0 && order.push("rewind"), rewind(t)
    )) as Tl["totalTime"];
    await window.__hfSwapScenes!(preview([A1, captions("n1", "hb2")]).html);
    expect(order.slice(0, 2)).toEqual(["rewind", "rewrite"]);
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("refuses a swap that brings in media or images this scene has not loaded", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    const withImage = { ...A2, body: '<img src="new.png">' };
    await expect(window.__hfSwapScenes!(preview([withImage, B]).html)).rejects.toThrow(
      "it loads media this scene has not loaded",
    );
    const withBackground = { ...A2, css: ".a{background:url(new.png)}" };
    await expect(window.__hfSwapScenes!(preview([withBackground, B]).html)).rejects.toThrow(
      "it loads media this scene has not loaded",
    );
    expect(document.querySelector('[data-hf-scene="a"]:not(style):not(script)')?.textContent).toBe(
      "A one",
    );
  });

  it.each([
    ["an inline style url()", '<p style="background:url(new.png)">A two</p>', ""],
    ["a poster", '<video poster="new.png"></video>', ""],
    ["a srcset", '<img srcset="new.png 2x">', ""],
    ["an uppercase URL()", "", ".a{background:URL(new.png)}"],
    ["an image-set()", "", '.a{background:image-set("new.png" 1x)}'],
    ["an @import", "", '@import "new.css";'],
    ["an SVG <image href>", '<svg><image href="new.png"></image></svg>', ""],
    ["an SVG <image xlink:href>", '<svg><image xlink:href="new.png"></image></svg>', ""],
    ["an <object data>", '<object data="new.svg"></object>', ""],
    ["a <source src>", '<video><source src="new.mp4"></video>', ""],
  ])("refuses new media brought in by %s", async (_, body, css) => {
    const { root } = trackingRoot();
    quietMedia();
    boot([A1, B], root);
    await tick();
    const edited = { ...A2, body: body || A2.body, css: A2.css + css };
    await expect(window.__hfSwapScenes!(preview([edited, B]).html)).rejects.toThrow(
      "scene a cannot be swapped: it loads media this scene has not loaded",
    );
  });

  it("swaps a scene whose bound image shows its variable's value, and refuses a bound one that is new", async () => {
    const { root } = trackingRoot();
    scoped.__hfVariablesByComp = { a: { logo: "brand.svg", other: "other.svg" } };
    const logo = '<img data-var-src="logo" src="assets/logo.svg">';
    boot([{ ...A1, body: `<p>A one</p>${logo}` }, B], root);
    await tick();
    await window.__hfSwapScenes!(preview([{ ...A2, body: `<p>A two</p>${logo}` }, B]).html);
    expect(sceneHost("a").querySelector("img")?.getAttribute("src")).toBe("brand.svg");
    const other = '<img data-var-src="other" src="brand.svg">';
    const withOther = { ...A2, hash: "ha3", body: `<p>A two</p>${logo}${other}` };
    await expect(window.__hfSwapScenes!(preview([withOther, B]).html)).rejects.toThrow(
      "it loads media",
    );
  });

  it("leaves a proxied video in a scene the edit did not touch on its proxy", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const proxied = proxyHostile();
    scoped.__hfVariablesByComp = { b: { clip: "clip.mov" } };
    const withVideo = { ...B, body: '<video data-var-src="clip" src="clip.mov"></video>' };
    boot([A1, withVideo], root);
    await tick();
    await tick();
    const video = sceneHost("b").querySelector("video")!;
    expect(video.src).toBe(proxied);
    await window.__hfSwapScenes!(preview([A2, withVideo]).html);
    await tick();
    expect(video.src).toBe(proxied);
  });

  it("keeps a proxied video in the edited scene on its proxy, and proxies a new copy of it", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const proxied = proxyHostile();
    scoped.__hfVariablesByComp = { a: { clip: "clip.mov" } };
    const video = '<video data-var-src="clip" src="placeholder.mp4"></video>';
    boot([{ ...A1, body: `<p>A one</p>${video}` }, B], root);
    await tick();
    await window.__hfSwapScenes!(
      preview([{ ...A2, body: `<p>A two</p>${video}${video}` }, B]).html,
    );
    await tick();
    const videos = Array.from(sceneHost("a").querySelectorAll("video"));
    expect(videos.map((v) => v.src)).toEqual([proxied, proxied]);
  });

  it("leaves the bound text of a scene the edit did not touch as it is", async () => {
    const { root } = trackingRoot();
    scoped.__hfVariablesByComp = { b: { title: "Hello" } };
    const titled = { ...B, body: '<p data-var-text="title">x</p>' };
    boot([A1, titled], root);
    await tick();
    const p = sceneHost("b").querySelector("p")!;
    expect(p.textContent).toBe("Hello");
    // A text tween part way through.
    p.textContent = "Hel";
    await window.__hfSwapScenes!(preview([A2, titled]).html);
    expect(p.textContent).toBe("Hel");
  });

  it("keeps the same video element through an edit beside it", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const scene = (text: string, video: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4" data-start="1" ${video}>one</video>`,
    });
    // The attribute the grading runtime stamps on every video as the page parses.
    boot([scene("A one", 'data-hf-authored-opacity=""', "ha1"), B], root);
    await tick();
    const video = sceneHost("a").querySelector("video");
    await window.__hfSwapScenes!(preview([scene("A two", "", "ha2"), B]).html);
    expect(sceneHost("a").querySelector("p")?.textContent).toBe("A two");
    expect(sceneHost("a").querySelector("video")).toBe(video);
    expect(video?.getAttribute("preload")).toBe("auto");
  });

  it("does not watch a page without a scene manifest as it parses", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    installAuthoredMediaCapture();
    expect(observe).not.toHaveBeenCalled();
  });

  it("stops watching the page it parses once the runtime starts", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    document.head.innerHTML = preview([A1, B]).head;
    installAuthoredMediaCapture();
    const watcher = observe.mock.contexts[0];
    boot([A1, B], trackingRoot().root);
    expect(watcher).toBeDefined();
    expect(disconnect.mock.contexts).toContain(watcher);
  });

  it("keeps a video a scene script wrote to while the page parsed", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const scene = (text: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4"></video>`,
    });
    document.head.innerHTML = preview([A1, B]).head;
    installAuthoredMediaCapture();
    mount([scene("A one", "ha1"), B], root);
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    // A tl.from() in the scene script writes its start value when the timeline is built.
    video.style.opacity = "0";
    initSandboxRuntimeModular();
    await tick();
    await window.__hfSwapScenes!(preview([scene("A two", "ha2"), B]).html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
  });

  it("records a video's <source> children that the parser adds after the video itself", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const scene = (text: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video><source src="clip.mp4"></video>`,
    });
    document.head.innerHTML = preview([A1, B]).head;
    installAuthoredMediaCapture();
    mount([scene("A one", "ha1"), B], root);
    const video = sceneHost("a").querySelector("video")!;
    const source = video.querySelector("source")!;
    // The parser yields with the video's children still to come.
    source.remove();
    await tick();
    video.appendChild(source);
    await tick();
    initSandboxRuntimeModular();
    await tick();
    await window.__hfSwapScenes!(preview([scene("A two", "ha2"), B]).html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
  });

  it("keeps a rebuilt video through the next edit though its scene script writes to it", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const scene = (text: string, attrs: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4" ${attrs}></video>`,
      script: `document.querySelector('[data-hf-scene="a"] video').style.opacity = "0";`,
    });
    boot([scene("A one", "", "ha1"), B], root);
    await tick();
    await window.__hfSwapScenes!(preview([scene("A two", "muted", "ha2"), B]).html);
    const rebuilt = sceneHost("a").querySelector("video");
    await window.__hfSwapScenes!(preview([scene("A three", "muted", "ha3"), B]).html);
    expect(sceneHost("a").querySelector("video")).toBe(rebuilt);
  });

  it("rebuilds a video whose scene script the edit changed, dropping what the old script wrote to it", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const write = `const v = document.querySelector('[data-hf-scene="a"] video'); v.style.opacity = "0"; v.muted = true;`;
    const scene = (text: string, script: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4"></video>`,
      script,
    });
    boot([scene("A one", write, "ha1"), B], root);
    new Function(document.querySelector('script[data-hf-scene="a"]')!.textContent!)();
    await tick();
    await window.__hfSwapScenes!(preview([scene("A two", "", "ha2"), B]).html);
    const video = sceneHost("a").querySelector("video")!;
    expect([video.style.opacity, video.muted]).toEqual(["", false]);
  });

  const writesOnlyOverTheFirstHeading = (write: string) =>
    `{ const scene = document.querySelector('[data-hf-scene="a"]:not(style):not(script)');` +
    `const video = scene.querySelector('video');` +
    `if (scene.querySelector('p').textContent === 'A one') ${write}; }`;
  const bootWithHeadingScript = (write: string, video = '<video src="clip.mp4"></video>') => {
    const scene = (text: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p>${video}`,
      script: writesOnlyOverTheFirstHeading(write),
    });
    boot([scene("A one", "ha1"), B], trackingRoot().root);
    const fresh = sceneHost("a").querySelector("video")!.outerHTML;
    new Function(document.querySelector('script[data-hf-scene="a"]')!.textContent!)();
    return { html: preview([scene("A two", "ha2"), B]).html, fresh };
  };

  it.each([
    ["muted", "video.muted = true", false],
    ["volume", "video.volume = 0.2", 1],
    ["playbackRate", "video.playbackRate = 2", 1],
    ["defaultPlaybackRate", "video.defaultPlaybackRate = 2", 1],
    ["preservesPitch", "video.preservesPitch = false", true],
  ] as const)(
    "gives a kept video the %s a fresh load gives it when its unchanged script wrote it only over the old text",
    async (property, write, fresh) => {
      quietMedia();
      const { html } = bootWithHeadingScript(write);
      await tick();
      const video = sceneHost("a").querySelector("video")!;
      expect(video[property]).not.toBe(fresh);
      await window.__hfSwapScenes!(html);
      expect(sceneHost("a").querySelector("video")).toBe(video);
      expect(video[property]).toBe(fresh);
    },
  );

  it("gives a kept video its authored data-volume back when its unchanged script wrote volume only over the old text", async () => {
    quietMedia();
    const { html } = bootWithHeadingScript(
      "video.volume = 0.2",
      '<video src="clip.mp4" data-volume="0.5"></video>',
    );
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    expect(video.volume).toBe(0.2);
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
    expect(video.volume).toBe(0.5);
  });

  it.each([
    "video.className = 'dim'",
    "video.hidden = true",
    "video.dataset.volume = '0.1'",
    "video.setAttribute('data-playback-rate', '2')",
    "video.poster = 'p.png'",
    "video.loop = true",
    "video.append(document.createElement('track'))",
  ])(
    "rebuilds a video as a fresh load has it when its unchanged script ran `%s` only over the old text",
    async (write) => {
      quietMedia();
      const { html, fresh } = bootWithHeadingScript(write);
      await tick();
      const video = sceneHost("a").querySelector("video")!;
      expect(video.outerHTML).not.toBe(fresh);
      await window.__hfSwapScenes!(html);
      const rebuilt = sceneHost("a").querySelector("video")!;
      expect(rebuilt).not.toBe(video);
      expect(rebuilt.outerHTML).toBe(fresh);
    },
  );

  it("keeps a video through a text edit when its unchanged script writes nothing to it", async () => {
    quietMedia();
    const { html } = bootWithHeadingScript("void video");
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
  });

  it.each([
    ["preload", '<video src="clip.mp4" preload="metadata"></video>', () => {}],
    ["a proxied src", '<video src="clip.mov"></video>', () => void proxyHostile()],
    [
      "a variable-bound src",
      '<video data-var-src="clip" src="placeholder.mp4"></video>',
      () => {
        scoped.__hfVariablesByComp = { a: { clip: "clip.mp4" } };
      },
    ],
    ["the opacity stamp", '<video src="clip.mp4"></video>', () => {}, "data-hf-authored-opacity"],
    [
      "the preview raster mark",
      '<video src="clip.mp4"></video>',
      () => {},
      "data-hf-preview-raster",
    ],
    ["the upcoming mark", '<video src="clip.mp4"></video>', () => {}, "data-hf-upcoming"],
  ])("keeps a video on which the runtime wrote %s", async (_, video, arrange, stamp?: string) => {
    quietMedia();
    arrange();
    const { html } = bootWithHeadingScript("void video", video);
    await tick();
    const kept = sceneHost("a").querySelector("video")!;
    if (stamp) kept.setAttribute(stamp, "");
    expect(kept.outerHTML).not.toBe(video);
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(kept);
  });

  it.each([
    ["the edit flash", "__hf-flash"],
    ["the picker's hover", "__hf-pick-highlight"],
  ])("keeps a video that carries %s class at the swap", async (_, name) => {
    quietMedia();
    const { html } = bootWithHeadingScript(
      "void video",
      '<video class="clip" src="clip.mp4"></video>',
    );
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    video.classList.add(name);
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
  });

  it("keeps a video that carries the edit flash as its only class at the swap", async () => {
    quietMedia();
    const { html } = bootWithHeadingScript("void video");
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    video.classList.add("__hf-flash");
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
  });

  it("keeps a video whose unchanged script removes an attribute and puts it back as it was", async () => {
    quietMedia();
    const { html } = bootWithHeadingScript(
      "video.removeAttribute('title'), video.setAttribute('title', 'clip')",
      '<video title="clip" data-id="v" src="clip.mp4"></video>',
    );
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    expect(video.getAttributeNames().at(-1)).toBe("title");
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
  });

  it("unmutes a kept video though stopping Web Audio puts back the mute it saved from the old script", async () => {
    quietMedia();
    const { html } = bootWithHeadingScript("video.muted = true");
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    // Web Audio captured the video while the old script had it muted, and restores that on its next stop.
    vi.spyOn(WebAudioTransport.prototype, "stopAll").mockImplementationOnce(() => {
      video.muted = true;
    });
    await window.__hfSwapScenes!(html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
    expect(video.muted).toBe(false);
  });

  it.each([
    ["a stream", "srcObject", {}],
    ["an output device", "sinkId", "speakers"],
    ["a key session", "mediaKeys", {}],
  ])(
    "rebuilds a video a script gave %s, which a fresh load does not have",
    async (_, key, value) => {
      quietMedia();
      const { html } = bootWithHeadingScript("void video");
      await tick();
      const video = sceneHost("a").querySelector("video")!;
      Object.defineProperty(video, key, { value });
      await window.__hfSwapScenes!(html);
      expect(sceneHost("a").querySelector("video")).not.toBe(video);
    },
  );

  it.each([
    ["rewinds and kills an old timeline that cannot revert", false, "", 1],
    ["reverts an old timeline that can, dropping the inline values it wrote", true, "", 0],
  ])(
    "%s, so a kept video carries none of its tweens' values",
    async (_, canRevert, opacity, kills) => {
      const { root } = trackingRoot();
      quietMedia();
      const scene = (text: string, hash: string): Scene => ({
        ...A1,
        hash,
        body: `<p>${text}</p><video src="clip.mp4" data-start="1">one</video>`,
      });
      boot([scene("A one", "ha1"), B], root);
      await tick();
      const video = sceneHost("a").querySelector("video")!;
      const old = made.a1!;
      const seek = old.totalTime.bind(old);
      const fadeOverTwentySeconds = (t?: number) => (
        t !== undefined && (video.style.opacity = String(1 - t / 20)), seek(t)
      );
      old.totalTime = fadeOverTwentySeconds as Tl["totalTime"];
      if (canRevert) Object.assign(old, { revert: () => video.style.removeProperty("opacity") });
      old.totalTime(10);
      // The same script registers a fresh timeline.
      made.a1 = made.a2!;
      await window.__hfSwapScenes!(preview([scene("A two", "ha2"), B]).html);
      expect(sceneHost("a").querySelector("video")).toBe(video);
      expect(video.style.opacity).toBe(opacity);
      // GSAP's revert() kills the timeline itself; a second kill() fires its onInterrupt again.
      expect(old.kill).toHaveBeenCalledTimes(kills);
    },
  );

  it.each([
    ["muted is added", "muted"],
    ["its timing and style change", 'data-start="1.5" style="opacity: 0.5"'],
    ["its fallback content changes", "", "two"],
    ["it is colour graded", `data-color-grading='{"adjust":{"exposure":1.5}}'`, "one", true],
  ])("rebuilds a video fresh when %s", async (_, edit, content = "one", graded = false) => {
    const { root } = trackingRoot();
    quietMedia();
    const scene = (text: string, attrs: string, inner: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4" ${attrs}>${inner}</video>`,
    });
    boot([scene("A one", graded ? edit : "", "one", "ha1"), B], root);
    await tick();
    const video = sceneHost("a").querySelector("video");
    await window.__hfSwapScenes!(preview([scene("A two", edit, content, "ha2"), B]).html);
    const rebuilt = sceneHost("a").querySelector("video");
    expect(rebuilt).not.toBe(video);
    const written = document.createElement("template");
    written.innerHTML = `<video ${edit}></video>`;
    for (const { name } of written.content.firstElementChild!.attributes)
      expect(rebuilt?.hasAttribute(name)).toBe(true);
    expect(rebuilt?.textContent).toBe(content);
    await window.__hfSwapScenes!(preview([scene("A three", edit, content, "ha3"), B]).html);
    const again = sceneHost("a").querySelector("video");
    if (graded) expect(again).not.toBe(rebuilt);
    else expect(again).toBe(rebuilt);
  });

  it("probes the swapped scene's media for volume once the scene is in the root timeline", async () => {
    const { root, children } = trackingRoot();
    const withAudio = (s: Scene, text: string): Scene => ({
      ...s,
      body: `<p>${text}</p><audio src="music.mp3" data-start="1" data-duration="2"></audio>`,
    });
    boot([withAudio(A1, "A one"), B], root);
    await tick();
    const probe = vi.mocked(probeAndCacheElementVolume);
    probe.mockClear();
    const nestedWhenProbed: boolean[] = [];
    probe.mockImplementation((el) => {
      if (el.isConnected) nestedWhenProbed.push(children.some((c) => c.child === made.a2));
    });
    await window.__hfSwapScenes!(preview([withAudio(A2, "A two"), B]).html);
    expect(nestedWhenProbed).toContain(true);
    probe.mockReset();
  });

  it("re-probes the volume of media kept through the swap against the new timeline", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const withAudio = (s: Scene, text: string): Scene => ({
      ...s,
      body: `<p>${text}</p><audio src="music.mp3" data-start="1" data-duration="2"></audio>`,
    });
    const probe = vi.mocked(probeAndCacheElementVolume);
    probe.mockImplementation((el, _timeline, _duration, cache) => void cache.set(el, []));
    boot([withAudio(A1, "A one"), B], root);
    await tick();
    const audio = sceneHost("a").querySelector("audio")!;
    const probedAudio = () => probe.mock.calls.filter(([el]) => el === audio).length;
    expect(probedAudio()).toBeGreaterThan(0);
    probe.mockClear();
    await window.__hfSwapScenes!(preview([withAudio({ ...A1, hash: "ha2" }, "A two"), B]).html);
    expect(sceneHost("a").querySelector("audio")).toBe(audio);
    expect(probedAudio()).toBeGreaterThan(0);
    probe.mockReset();
  });

  it("gives the swapped scene's host its per-instance CSS variables", async () => {
    const { root } = trackingRoot();
    scoped.__hfVariablesByComp = { a: { accent: "#ff0000" } };
    boot([A1, B], root);
    await tick();
    await window.__hfSwapScenes!(preview([A2, B]).html);
    expect((sceneHost("a") as HTMLElement).style.getPropertyValue("--accent")).toBe("#ff0000");
  });

  it("adds no asset error listener to the swapped scene, which would keep it after it is swapped out", async () => {
    const { root } = trackingRoot();
    const withImage = (s: Scene): Scene => ({ ...s, body: `${s.body}<img src="logo.png">` });
    boot([withImage(A1), B], root);
    await tick();
    const listen = vi.spyOn(EventTarget.prototype, "addEventListener");
    await window.__hfSwapScenes!(preview([withImage(A2), B]).html);
    const img = sceneHost("a").querySelector("img");
    const onImg = listen.mock.contexts.filter(
      (el, i) => el === img && listen.mock.calls[i]![0] === "error",
    );
    expect(onImg).toHaveLength(0);
  });

  it("re-applies a moved element's position edit after the swap", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    const moved = { ...A2, body: '<p data-x="30" data-hf-edit-base-x="0">A two</p>' };
    await window.__hfSwapScenes!(preview([moved, B]).html);
    const p = document.querySelector('[data-hf-scene="a"]:not(style):not(script) p') as HTMLElement;
    expect(p.style.translate).toContain("30");
  });

  it("keeps a moved video where it was moved, as a fresh load puts it, through an edit beside it", async () => {
    const { root } = trackingRoot();
    quietMedia();
    const moved = 'data-x="40" data-y="7" data-hf-edit-base-x="0" data-hf-edit-base-y="0"';
    const scene = (text: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4" ${moved}></video>`,
    });
    boot([scene("A one", "ha1"), B], root);
    await tick();
    const video = sceneHost("a").querySelector("video")!;
    expect(video.style.getPropertyValue("translate")).toBe("40px 7px");
    await window.__hfSwapScenes!(preview([scene("A two", "ha2"), B]).html);
    expect(sceneHost("a").querySelector("video")).toBe(video);
    expect(video.style.getPropertyValue("translate")).toBe("40px 7px");
  });

  it("rejects a scene the bundler marked as not swappable, naming why", async () => {
    const { root } = trackingRoot();
    const marked = (s: Scene): Scene => ({
      ...s,
      extraAttrs: ' data-hf-scene-no-swap="its script uses addEventListener"',
    });
    boot([marked(A1), B], root);
    await tick();
    await expect(window.__hfSwapScenes!(preview([marked(A2), B]).html)).rejects.toThrow(
      "scene a cannot be swapped: its script uses addEventListener",
    );
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it.each([
    ["the root timeline", "host", (root: Tl) => root],
    ["the root timeline", "text", (root: Tl) => root],
    ["another scene's timeline", "text", () => made.b],
  ])("refuses, changing nothing, when %s tweens the scene's %s", async (_, target, owner) => {
    const { root } = trackingRoot();
    const tweened = () => (target === "host" ? sceneHost("a") : sceneHost("a").querySelector("p"));
    const tween = { parent: owner(root), targets: () => [tweened()] };
    (window as unknown as { gsap: unknown }).gsap = {
      set: () => {},
      globalTimeline: { getChildren: () => [tween] },
    };
    boot([A1, B], root);
    await tick();
    const before = document.documentElement.innerHTML;
    await expect(window.__hfSwapScenes!(preview([A2, B]).html)).rejects.toThrow(
      "scene a cannot be swapped: an animation outside it moves its elements",
    );
    expect(document.documentElement.innerHTML).toBe(before);
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("swaps a scene whose elements only its own and its nested scenes' timelines tween", async () => {
    const { root } = trackingRoot();
    const nested = (s: Scene): Scene => ({
      ...s,
      body: `${s.body}<div data-composition-id="n"><i>n</i></div>`,
    });
    const own = { parent: made.a1, targets: () => [sceneHost("a")] };
    const inNested = { parent: { parent: made.n1 }, targets: () => [sceneHost("a")] };
    const elsewhere = { parent: root, targets: () => [sceneHost("b")] };
    (window as unknown as { gsap: unknown }).gsap = {
      set: () => {},
      globalTimeline: { getChildren: () => [own, inNested, elsewhere] },
    };
    boot([nested(A1), B], root);
    window.__timelines!.n = made.n1;
    await tick();
    await window.__hfSwapScenes!(preview([nested(A2), B]).html);
    expect(sceneHost("a").querySelector("p")?.textContent).toBe("A two");
  });

  it.each([
    ["a timeline it never registers", `gsap.timeline().to("p", { x: 100 });`],
    ["gsap under another name", `const g = gsap; g.to("p", { x: 100 });`],
    ["gsap by a computed key", `gsap["to"]("p", { x: 100 });`],
    ["the unscoped global", `globalThis.gsap.to("p", { x: 100 });`],
  ])(
    "stops what the old scene script started through %s, so one copy runs after the swap",
    async (_, source) => {
      const { root } = trackingRoot();
      const running = new Set<object>();
      const globalTimeline = { getChildren: () => [...running] };
      const start = () => {
        const p = sceneHost("a").querySelector("p");
        const animation = {
          parent: globalTimeline,
          targets: () => [p],
          to: () => animation,
          revert: () => void running.delete(animation),
        };
        running.add(animation);
        return animation;
      };
      vi.stubGlobal("gsap", {
        set: () => {},
        globalTimeline,
        timeline: start,
        to: start,
      });
      const scene = (s: Scene): Scene => ({
        ...s,
        script: wrapScopedCompositionScript(source, "a"),
      });
      boot([scene(A1), B], root);
      new Function(document.querySelector('script[data-hf-scene="a"]')!.textContent!)();
      await tick();
      expect(running.size).toBe(1);
      await window.__hfSwapScenes!(preview([scene(A2), B]).html);
      expect(running.size).toBe(1);
      expect(window.__hfSceneAnimations?.a).toHaveLength(1);
    },
  );

  it("reverts a scene's timeline once though its script also recorded it", async () => {
    const { root } = trackingRoot();
    const revert = vi.fn();
    Object.assign(made.a1!, { revert });
    boot([A1, B], root);
    await tick();
    window.__hfSceneAnimations = { a: [made.a1!] };
    await window.__hfSwapScenes!(preview([A2, B]).html);
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it("reverts a scene's recorded animations newest first, so each restores what the one before it wrote", async () => {
    const { root } = trackingRoot();
    const order: string[] = [];
    const animation = (name: string) => ({ revert: () => void order.push(name) });
    Object.assign(made.a1!, animation("timeline"));
    boot([A1, B], root);
    await tick();
    window.__hfSceneAnimations = { a: [made.a1!, animation("first set"), animation("second set")] };
    await window.__hfSwapScenes!(preview([A2, B]).html);
    expect(order).toEqual(["second set", "first set", "timeline"]);
  });

  const writesOutside = "scene a cannot be swapped: its animations write outside the scene";
  const asFresh = "swapped, as a fresh load, video kept";
  const thenFrom = `tl.from(k, { x: 0, duration: 1 });`;
  const shapes = {
    "a free from()": `gsap.from(k, { x: "+=50", duration: 1 }); ${thenFrom}`,
    "a free fromTo()": `gsap.fromTo(k, { x: "+=50" }, { x: "+=0", duration: 1 }); ${thenFrom}`,
    "a tween moved to its end": `gsap.to(k, { x: "+=50", duration: 0.5 }).progress(1); ${thenFrom}`,
    "a second timeline's from()": `gsap.timeline({ paused: true }).from(k, { x: "+=50", duration: 1 }); ${thenFrom}`,
    "a relative set": `gsap.set(k, { x: "+=50" }); ${thenFrom}`,
    "a nested timeline's to() before its from()": `tl.add(gsap.timeline().to(k, { x: 10, duration: 0.5 }).from(k, { x: 0, duration: 1 }), 0);`,
  };
  it.each([
    ...Object.entries(shapes).flatMap(([shape, body]) => [
      [shape, "video", body, asFresh],
      [shape, "#kept", body, writesOutside],
    ]),
    [
      "a to() before a from() on one property",
      "video",
      `tl.to(k, { opacity: 0.5, duration: 0.5 }, 0).from(k, { opacity: 0, duration: 1 }, 0.5);`,
      asFresh,
    ],
    [
      "a fade in, then out",
      "video",
      `tl.from(k, { opacity: 0, duration: 1 }, 0).to(k, { opacity: 0, duration: 1 }, 1.5);`,
      asFresh,
    ],
    ["a lone set", "video", `gsap.set(k, { x: 50 });`, asFresh],
    ["a lone timeline from()", "video", `tl.from(k, { x: 50, duration: 1 });`, asFresh],
    [
      "a set on its text and a timeline from()",
      "video",
      `gsap.set("p", { x: 20 }); tl.from(k, { x: 50, duration: 1 });`,
      asFresh,
    ],
    [
      "one timeline moving it twice",
      "video",
      `tl.from(k, { x: 50, duration: 1 }).to(k, { x: "+=30", duration: 1 });`,
      asFresh,
    ],
    ["a lone timeline to()", "#kept", `tl.to(k, { x: 10, duration: 1 });`, writesOutside],
    [
      "a padding tween on an empty object",
      "video",
      `tl.to({}, { duration: 2 }); tl.from(k, { x: 50, duration: 1 }, 0);`,
      asFresh,
    ],
    [
      "a counter on a local object",
      "video",
      `const state = { n: 0 }; tl.to(state, { n: 10, duration: 1, onUpdate: () => void (k.dataset.n = String(Math.round(state.n))) }); tl.from(k, { x: 50, duration: 1 }, 0);`,
      // The attribute its callback writes is not in the markup, so the video is rebuilt.
      "swapped, as a fresh load",
    ],
    [
      "a move the record missed, as a callback's",
      "video",
      `globalThis.__missed = () => gsap.set(k, { x: 30 }); tl.from(k, { opacity: 0, duration: 1 });`,
      asFresh,
    ],
  ])("a scene script with %s on %s", async (_, el, body, expected) => {
    const exports: { gsap?: RealGsap } = {};
    // Its ticker takes the frame callback as it loads, and this file's runs at once: give it one that never ticks.
    const frame = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    new Function("exports", "module", readFileSync(vendoredGsap(), "utf8"))(exports, { exports });
    window.requestAnimationFrame = frame;
    const gsap = exports.gsap!;
    vi.stubGlobal("gsap", gsap);
    quietMedia();
    const source = `const k = globalThis.document.querySelector(${JSON.stringify(el)});
const tl = gsap.timeline({ paused: true });
${body}
window.__timelines.a = tl;`;
    const scene = (text: string, hash: string): Scene => ({
      ...A1,
      hash,
      body: `<p>${text}</p><video src="clip.mp4" style="opacity: 0.5"></video>`,
      script: wrapScopedCompositionScript(source, "a"),
    });
    boot([scene("A one", "ha1"), B], trackingRoot().root);
    document.body.insertAdjacentHTML("beforeend", '<div id="kept"></div>');
    new Function(document.querySelector('script[data-hf-scene="a"]')!.textContent!)();
    // The old page is a fresh load of the same script.
    const along = () => {
      const timeline = window.__timelines!.a!;
      const k = document.querySelector(el)!;
      return [0, 0.25, 0.5, 0.75, 1]
        .map((at) => {
          timeline.totalTime!(at * timeline.duration());
          return `${gsap.getProperty(k, "x")}/${gsap.getProperty(k, "opacity")}`;
        })
        .join(" ");
    };
    const fresh = along();
    (globalThis as { __missed?: () => void }).__missed?.();
    const video = sceneHost("a").querySelector("video");
    const swapped = await window.__hfSwapScenes!(preview([scene("A two", "ha2"), B]).html).then(
      () => {
        const values = along();
        const kept = sceneHost("a").querySelector("video") === video ? ", video kept" : "";
        return values === fresh
          ? `swapped, as a fresh load${kept}`
          : `swapped: ${values} against ${fresh}`;
      },
      (error: Error) => error.message,
    );
    gsap.ticker.sleep();
    delete (globalThis as { __missed?: () => void }).__missed;
    expect(swapped).toBe(expected);
  });

  it("rejects a scene with more than one host rather than dropping one", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    const twoHosts = preview([A2, B]).html.replace(
      '<div data-composition-id="b"',
      '<div data-hf-scene="a"><p>second</p></div><div data-composition-id="b"',
    );
    await expect(window.__hfSwapScenes!(twoHosts)).rejects.toThrow("no single host");
  });

  it("keeps the swapped scene's style where the old one was", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    await window.__hfSwapScenes!(preview([A2, B]).html);
    expect(cssText().indexOf(".a{color:green}")).toBeLessThan(cssText().indexOf(".b{color:blue}"));
  });

  it("replaces each of a scene's separated styles in place, so same-named @keyframes cascade as a fresh load's do", async () => {
    const { root } = trackingRoot();
    // Scene a's nested scene comes after b in source order, so a owns a second style run after b's.
    const secondStyle = (css: string) => (html: string) =>
      html.replace(
        `.b{color:blue}</style>`,
        `.b{color:blue}</style><style data-hf-scene="a">${css}</style>`,
      );
    boot([A1, B], root, secondStyle(".a2{color:red}"));
    await tick();
    const edited = secondStyle(".a2{color:green}")(preview([A2, B]).html);
    await window.__hfSwapScenes!(edited);
    const sceneStyles = Array.from(
      document.head.querySelectorAll("style[data-hf-scene]"),
      (el) => el.textContent,
    );
    expect(sceneStyles).toEqual([".a{color:green}", ".b{color:blue}", ".a2{color:green}"]);
  });

  it("refuses a swap whose scene has a different number of style parts", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    const extra = preview([A2, B]).html.replace(
      `.b{color:blue}</style>`,
      `.b{color:blue}</style><style data-hf-scene="a">.a2{}</style>`,
    );
    await expect(window.__hfSwapScenes!(extra)).rejects.toThrow("its styles moved");
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("puts the swapped scene's CSS animations under the playhead", async () => {
    const { root } = trackingRoot();
    // jsdom has no CSSAnimation; the CSS adapter seeks only its instances, read live document-wide.
    class CSSAnimation {}
    vi.stubGlobal("CSSAnimation", CSSAnimation);
    const animation = Object.assign(new CSSAnimation(), {
      currentTime: null as number | null,
      pause: vi.fn(),
      play: vi.fn(),
      effect: { target: null as Element | null },
    });
    document.getAnimations = () => {
      animation.effect.target =
        Array.from(document.querySelectorAll("p")).find((p) => p.textContent === "A two") ?? null;
      return animation.effect.target ? [animation as unknown as Animation] : [];
    };
    try {
      boot([A1, B], root);
      await tick();
      window.__player?.renderSeek(2);
      const animated: Scene = {
        ...A2,
        body: '<p style="animation-name: spin; animation-duration: 2s">A two</p>',
      };
      await window.__hfSwapScenes!(preview([animated, B]).html);
      // The CSS adapter's seek to 1 s into scene a, hosted at 1; WAAPI alone would leave 0.
      expect(animation.currentTime).toBe(1000);
      expect(animation.pause).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(document, "getAnimations");
    }
  });

  it("rejects a swap the preview was torn down during", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    window.__hfRuntimeTeardown?.();
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("torn down");
  });

  it("leaves the page untouched while the caption overrides are still loading", async () => {
    const { before } = await bootWithPendingCaptions();
    for (let i = 0; i < 5; i++) await tick();
    expect(document.documentElement.innerHTML).toBe(before);
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("refuses a swap when an outside animation starts on the scene while its caption overrides load", async () => {
    const { swap, before, answer } = await bootWithPendingCaptions();
    const tween = { targets: () => [sceneHost("a")] };
    Object.assign(window.gsap!, { globalTimeline: { getChildren: () => [tween] } });
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("an animation outside it moves its elements");
    expect(document.documentElement.innerHTML).toBe(before);
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("checks the timeline registry as it is after the caption wait, which a data handler may replace", async () => {
    const { swap, before, answer } = await bootWithPendingCaptions();
    const movesB = { targets: () => [sceneHost("b")], getChildren: () => [] };
    // As a runtime-data handler may: a new registry object, whose scene-a timeline moves scene b.
    window.__timelines = { ...window.__timelines, a: movesB as unknown as RuntimeTimelineLike };
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("its animations write outside the scene");
    expect(document.documentElement.innerHTML).toBe(before);
  });

  it("refuses a swap whose scene was replaced while its caption overrides loaded", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    const live = sceneHost("a");
    live.replaceWith(live.cloneNode(true));
    const manifest = () =>
      document.querySelector('meta[name="hf-scene-parts"]')?.getAttribute("content");
    const before = manifest();
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
    expect(manifest()).toBe(before);
  });

  it("refuses a swap whose scene host moved to another parent while its caption overrides loaded", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    const manifest = () =>
      document.querySelector('meta[name="hf-scene-parts"]')?.getAttribute("content");
    const before = manifest();
    // As a runtime-data handler may: the host stays in the page, outside the film.
    document.body.appendChild(sceneHost("a"));
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
    expect(manifest()).toBe(before);
  });

  it("refuses a swap whose scene's wrapper left the film while its caption overrides loaded", async () => {
    const wrapper = document.createElement("div");
    const wrap = () => {
      sceneHost("a").before(wrapper);
      wrapper.append(sceneHost("a"));
    };
    const { swap, answer } = await bootWithPendingCaptions(undefined, wrap);
    // The host keeps its parent; the parent leaves the film.
    document.body.appendChild(wrapper);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  const filmRoot = () => document.querySelector<HTMLElement>("[data-root]")!;
  const wrapA = () => {
    const wrapper = document.createElement("div");
    sceneHost("a").before(wrapper);
    wrapper.append(sceneHost("a"));
    return wrapper;
  };

  it("refuses a swap whose scene's wrapper moved past the next scene while its caption overrides loaded", async () => {
    let wrapper!: HTMLElement;
    const { swap, answer } = await bootWithPendingCaptions(
      undefined,
      () => void (wrapper = wrapA()),
    );
    // A keeps its parent and its next sibling (none) and stays in the film; only the order changes.
    sceneHost("b").after(wrapper);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene moved with its neighbour as a pair while its caption overrides loaded", async () => {
    const C: Scene = { id: "c", start: 5, body: "<p>C</p>", css: ".c{}", label: "n2", hash: "hc" };
    const { swap, answer } = await bootWithPendingCaptions(undefined, undefined, [B, C]);
    // A's next sibling is still B; the pair now comes after C.
    filmRoot().append(sceneHost("a"), sceneHost("b"));
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene's wrapper moved into another container in the film while its caption overrides loaded", async () => {
    let wrapper!: HTMLElement;
    const container = document.createElement("div");
    const arrange = () => {
      wrapper = wrapA();
      wrapper.after(container);
    };
    const { swap, answer } = await bootWithPendingCaptions(undefined, arrange);
    // Same order, same parent and next sibling for A, still in the film: only its ancestors changed.
    container.append(wrapper);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene moved before a background in the film while its caption overrides loaded", async () => {
    const background = document.createElement("div");
    const { swap, answer } = await bootWithPendingCaptions(undefined, () =>
      filmRoot().prepend(background),
    );
    // Scene order and ancestors are unchanged; A now sits under the background instead of over it.
    background.before(sceneHost("a"));
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("swaps a scene beside which the runtime inserted one of its own elements while its caption overrides loaded", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    // As colour grading does for a graded video beside the scene.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-hf-ignore", "");
    sceneHost("a").after(canvas);
    answer(new Response("null", { status: 404 }));
    await swap;
    expect(sceneHost("a").querySelector(".caption-group")).not.toBeNull();
  });

  it("refuses a swap whose scene moved as a block with both its neighbours while its caption overrides loaded", async () => {
    const [p, q, r, s] = ["p", "q", "r", "s"].map(() => document.createElement("div"));
    // The film reads P, a, Q, R, S, b.
    const arrange = () => {
      sceneHost("a").before(p!);
      sceneHost("a").after(q!, r!, s!);
    };
    const { swap, answer } = await bootWithPendingCaptions(undefined, arrange);
    // Now R, P, a, Q, S, b: every neighbour, the scene order and the ancestors are unchanged.
    r!.after(p!, sceneHost("a"), q!);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene's wrapper left the film with no other scene beside it while its caption overrides loaded", async () => {
    let wrapper!: HTMLElement;
    const [before, after] = [document.createElement("div"), document.createElement("div")];
    // The film reads X, [a], Y, b: the wrapper's neighbours are plain elements.
    const arrange = () => {
      wrapper = wrapA();
      wrapper.before(before);
      wrapper.after(after);
    };
    const { swap, answer } = await bootWithPendingCaptions(undefined, arrange);
    document.body.appendChild(wrapper);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene's wrapper moved before a background in the film while both scenes are wrapped", async () => {
    const background = document.createElement("div");
    let wrapper!: HTMLElement;
    // The film reads background, [a], [b]: no scene is a direct child of the film root.
    const arrange = () => {
      wrapper = wrapA();
      const other = document.createElement("div");
      sceneHost("b").before(other);
      other.append(sceneHost("b"));
      filmRoot().prepend(background);
    };
    const { swap, answer } = await bootWithPendingCaptions(undefined, arrange);
    // Each wrapper still holds its scene alone; only the film root's order changed.
    background.before(wrapper);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene style moved to another parent while its caption overrides loaded", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    // The new style would take the moved one's place, out of cascade order.
    document.body.appendChild(document.querySelector('style[data-hf-scene="a"]')!);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("refuses a swap whose scene moved to another place in its parent while its caption overrides loaded", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    sceneHost("a").parentElement!.appendChild(sceneHost("a"));
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("a scene changed while this swap waited");
  });

  it("swaps a scene whose script is last in the page though something is appended after it during the wait", async () => {
    // As after an earlier swap of the scene, which appends its new script at the end of the page.
    const lastScript = () =>
      document.body.appendChild(document.querySelector('script[data-hf-scene="a"]')!);
    const { swap, answer } = await bootWithPendingCaptions(undefined, lastScript);
    document.body.appendChild(document.createElement("div"));
    answer(new Response("null", { status: 404 }));
    await swap;
    expect(sceneHost("a").querySelector(".caption-group")).not.toBeNull();
  });

  it("refuses a swap whose signal was aborted before the call, changing nothing", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    const before = document.documentElement.innerHTML;
    const cancel = new AbortController();
    cancel.abort();
    await expect(window.__hfSwapScenes!(preview([A2, B]).html, cancel.signal)).rejects.toThrow(
      "the swap was cancelled",
    );
    expect(document.documentElement.innerHTML).toBe(before);
  });

  it("refuses a swap the caller cancelled while its caption overrides loaded, changing nothing", async () => {
    const cancel = new AbortController();
    const { swap, before, answer } = await bootWithPendingCaptions(cancel.signal);
    cancel.abort();
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("the swap was cancelled");
    expect(document.documentElement.innerHTML).toBe(before);
    expect(made.a1!.kill).not.toHaveBeenCalled();
  });

  it("refuses when stopping a scene's timeline replaces the registry with one moving another scene", async () => {
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    const movesB = { targets: () => [sceneHost("b")], getChildren: () => [] };
    // As an onInterrupt that revert() fires can: a new registry whose scene-a timeline moves scene b.
    const replaceRegistry = () =>
      void (window.__timelines = {
        ...window.__timelines,
        a: movesB as unknown as RuntimeTimelineLike,
      });
    Object.assign(made.a1!, { revert: replaceRegistry });
    boot([A1, B], root);
    await tick();
    await expect(window.__hfSwapScenes!(preview([A2, B]).html)).rejects.toThrow(
      "its animations write outside the scene",
    );
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("stops, too, what stopping a scene's timeline registers, however deep the chain", async () => {
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    const reverted: number[] = [];
    // Each revert registers a fresh scene-a timeline, three levels deep, as chained onInterrupt callbacks can.
    const chained = (level: number): RuntimeTimelineLike =>
      ({
        getChildren: () => [],
        revert: () => {
          reverted.push(level);
          if (level < 3) window.__timelines = { ...window.__timelines, a: chained(level + 1) };
        },
      }) as unknown as RuntimeTimelineLike;
    Object.assign(made.a1!, {
      revert: () => void (window.__timelines = { ...window.__timelines, a: chained(1) }),
    });
    boot([A1, B], root);
    await tick();
    await window.__hfSwapScenes!(preview([A2, B]).html);
    expect(reverted).toEqual([1, 2, 3]);
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("refuses when stopping a scene's timeline replaces that scene's host", async () => {
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    const replaceHost = () => {
      const live = sceneHost("a");
      live.replaceWith(live.cloneNode(true));
    };
    Object.assign(made.a1!, { revert: replaceHost });
    boot([A1, B], root);
    await tick();
    await expect(window.__hfSwapScenes!(preview([A2, B]).html)).rejects.toThrow(
      "a scene changed while this swap waited",
    );
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("refuses when stopping a scene's timeline moves that scene's host to another parent", async () => {
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    Object.assign(made.a1!, { revert: () => void document.body.appendChild(sceneHost("a")) });
    boot([A1, B], root);
    await tick();
    await expect(window.__hfSwapScenes!(preview([A2, B]).html)).rejects.toThrow(
      "a scene changed while this swap waited",
    );
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("refuses when stopping a scene's timeline moves the scene's wrapper out of the film", async () => {
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    const wrapper = document.createElement("div");
    Object.assign(made.a1!, { revert: () => void document.body.appendChild(wrapper) });
    boot([A1, B], root);
    await tick();
    sceneHost("a").before(wrapper);
    wrapper.append(sceneHost("a"));
    await expect(window.__hfSwapScenes!(preview([A2, B]).html)).rejects.toThrow(
      "a scene changed while this swap waited",
    );
    delete (window as unknown as { gsap?: unknown }).gsap;
  });

  it("stops a playing film at its new end when the edit shortens it to before the playhead", async () => {
    const { root } = trackingRoot();
    let length = 6;
    root.duration = () => length;
    boot([A1, B], root);
    // An auto-duration film: its length follows the timeline.
    document.querySelector("[data-root]")!.removeAttribute("data-duration");
    await tick();
    window.__player!.seek(5.5);
    window.__player!.play();
    expect(window.__player!.isPlaying()).toBe(true);
    length = 5;
    await window.__hfSwapScenes!(preview([A2, B]).html);
    expect([window.__player!.isPlaying(), window.__player!.getTime()]).toEqual([false, 5]);
  });

  it("runs the new scene scripts once every edited scene is replaced, so none binds to one still to go", async () => {
    const { root } = trackingRoot();
    const bound: Element[] = [];
    (window as unknown as { __bind: () => void }).__bind = () => bound.push(sceneHost("b"));
    boot([A1, B], root);
    await tick();
    const B2: Scene = { ...B, body: "<p>B two</p>", hash: "hb2" };
    await window.__hfSwapScenes!(preview([{ ...A2, script: "window.__bind?.();" }, B2]).html);
    expect(bound.map((el) => el.isConnected)).toEqual([true]);
  });

  it("refuses, for the caller's reload, when stopping one scene starts an animation on another it swaps", async () => {
    const { root } = trackingRoot();
    const running: object[] = [];
    (window as unknown as { gsap: unknown }).gsap = {
      set: () => {},
      globalTimeline: { getChildren: () => [...running] },
    };
    // As the old timeline's onInterrupt can when revert() interrupts it.
    const startOnB = () => void running.push({ targets: () => [sceneHost("b")] });
    Object.assign(made.a1!, { revert: startOnB });
    boot([A1, B], root);
    await tick();
    const B2: Scene = { ...B, body: "<p>B two</p>", hash: "hb2" };
    await expect(window.__hfSwapScenes!(preview([A2, B2]).html)).rejects.toThrow(
      "scene b cannot be swapped",
    );
  });

  it("rejects a swap another swap overtook while its caption overrides loaded", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    const B2: Scene = { ...B, body: "<p>B two</p>", label: "n1", hash: "hb2" };
    await window.__hfSwapScenes!(preview([A1, B2]).html);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("changed");
    expect(sceneHost("a").textContent).toBe("A one");
    expect(sceneHost("b").textContent).toBe("B two");
  });

  it("rejects a waiting swap after other swaps changed its scene and changed it back", async () => {
    const { swap, answer } = await bootWithPendingCaptions();
    const A3: Scene = { ...A1, body: "<p>A three</p>", label: "n1", hash: "ha3" };
    await window.__hfSwapScenes!(preview([A3, B]).html);
    await window.__hfSwapScenes!(preview([A1, B]).html);
    answer(new Response("null", { status: 404 }));
    await expect(swap).rejects.toThrow("changed");
  });

  it("warns about a data-var-src on a non-media tag once for the new element, as a load does", async () => {
    const { root } = trackingRoot();
    scoped.__hfVariablesByComp = { a: { page: "page.html" } };
    const frame = (s: Scene): Scene => ({
      ...s,
      body: `${s.body}<iframe data-var-src="page"></iframe>`,
    });
    boot([frame(A1), B], root);
    await tick();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await window.__hfSwapScenes!(preview([frame(A2), B]).html);
    const ignored = warn.mock.calls.filter(([m]) => String(m).includes("Ignoring data-var-src"));
    expect(ignored).toHaveLength(1);
  });

  it("offers no swap on a page served without a scene manifest", async () => {
    const { root } = trackingRoot();
    boot([A1, B], root);
    await tick();
    expect(window.__hfSwapScenes).toBeTypeOf("function");
    window.__hfRuntimeTeardown?.();
    document.querySelector('meta[name="hf-scene-parts"]')?.remove();
    initSandboxRuntimeModular();
    expect(window.__hfSwapScenes).toBeUndefined();
  });

  it("re-applies caption overrides only to the swapped scene's words", async () => {
    const { root } = trackingRoot();
    const set = vi.fn();
    (window as unknown as { gsap: unknown }).gsap = { set, getTweensOf: () => [] };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json([
        { wordIndex: 0, opacity: 0.5 },
        { wordIndex: 1, opacity: 0.5 },
      ]),
    );
    const words = (s: Scene, word: string): Scene => ({
      ...s,
      body: `<div class="caption-group"><span>${word}</span></div>`,
    });
    boot([words(A1, "a"), words(B, "b")], root);
    for (let i = 0; i < 5; i++) await tick();
    const atBoot = set.mock.calls.map(([el]) => (el as Element).textContent);
    expect(atBoot).toEqual(expect.arrayContaining(["a", "b"]));
    set.mockClear();
    await window.__hfSwapScenes!(
      preview([{ ...words(A2, "a2"), hash: "hw2" }, words(B, "b")]).html,
    );
    const touched = set.mock.calls.map(([el]) => (el as Element).textContent);
    expect(touched).toContain("a2");
    expect(touched).not.toContain("b");
    delete (window as unknown as { gsap?: unknown }).gsap;
  });
});

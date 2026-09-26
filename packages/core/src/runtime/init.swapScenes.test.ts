import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular, installAuthoredMediaCapture } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { resetRuntimeDataForTests } from "./runtimeData";
import { probeAndCacheElementVolume } from "./mediaVolumeEnvelope.js";
import { wrapScopedCompositionScript } from "../compiler/compositionScoping";

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
          `<script data-hf-scene="${s.id}">${sceneScript(s.id, s.label)}${s.script ?? ""}</script>`,
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
  // Run each scene script the swap appends when it is appended, as a browser would.
  const append = document.body.appendChild.bind(document.body);
  document.body.appendChild = <T extends Node>(node: T): T => {
    append(node);
    if (node instanceof HTMLScriptElement && node.hasAttribute("data-hf-scene"))
      new Function(node.textContent ?? "")();
    return node;
  };
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
  window.__HF_MEDIA_CODEC_MAP__ = {
    "/clip.mov": { codecName: "prores", browserHostile: true, representativeMime: null },
  };
  return new URL("clip.mov?hf-proxy=h264", document.baseURI).href;
};
const cssText = () =>
  [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("");

// Boots A1 and B, then starts swapping in a captioned A whose caption overrides have not arrived.
async function bootWithPendingCaptions() {
  const { root } = trackingRoot();
  (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
  let answer: (r: Response) => void = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise<Response>((resolve) => (answer = resolve)),
  );
  boot([A1, B], root);
  await tick();
  const before = document.documentElement.innerHTML;
  const captions: Scene = { ...A2, body: '<div class="caption-group"><span>w</span></div>' };
  const swap = window.__hfSwapScenes!(preview([captions, B]).html);
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
    Reflect.deleteProperty(document.body, "appendChild");
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
    const video = sceneHost("b").querySelector("video")!;
    expect(video.src).toBe(proxied);
    await window.__hfSwapScenes!(preview([A2, withVideo]).html);
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

  it.each([
    ["rewinds and kills an old timeline that cannot revert", false, "1", 1],
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
    const animation = { currentTime: null as number | null, pause: vi.fn(), play: vi.fn() };
    const proto = HTMLElement.prototype as unknown as { getAnimations?: () => unknown[] };
    proto.getAnimations = function (this: HTMLElement) {
      return this.textContent === "A two" ? [animation] : [];
    };
    try {
      boot([A1, B], root);
      await tick();
      const animated: Scene = {
        ...A2,
        body: '<p style="animation-name: spin; animation-duration: 2s">A two</p>',
      };
      await window.__hfSwapScenes!(preview([animated, B]).html);
      expect(animation.currentTime).toBeTypeOf("number");
      expect(animation.pause).toHaveBeenCalled();
    } finally {
      delete proto.getAnimations;
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

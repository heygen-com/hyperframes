import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { resetRuntimeDataForTests } from "./runtimeData";

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
      .map((s) => `<script data-hf-scene="${s.id}">${sceneScript(s.id, s.label)}</script>`)
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

let observer: MutationObserver | null = null;

function boot(scenes: Scene[], root: Tl) {
  const { head, body } = preview(scenes);
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  window.__timelines = { main: root };
  for (const s of scenes) window.__timelines[s.id] = made[s.label];
  // Run each scene script the swap creates, as a browser would.
  observer = new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes)
        if (n instanceof HTMLScriptElement && n.hasAttribute("data-hf-scene"))
          new Function(n.textContent ?? "")();
  });
  observer.observe(document.body, { childList: true });
  initSandboxRuntimeModular();
}

const tick = () => new Promise<void>((r) => window.setTimeout(r, 0));
const cssText = () =>
  [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("");

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
    observer?.disconnect();
    window.__hfRuntimeTeardown?.();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
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
    const video = (tag: string) => ({ ...A1, body: `<video>${tag}</video>` });
    boot([video('<source src="https://example.com/a.mp4">'), B], root);
    await tick();
    const old = document.querySelector("video")!;
    await window.__hfSwapScenes!(
      preview([{ ...video('<source src="https://example.com/b.mp4">'), hash: "hv2" }, B]).html,
    );
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
    const { root } = trackingRoot();
    (window as unknown as { gsap: unknown }).gsap = { set: () => {} };
    const captions: Scene = { ...A2, body: '<div class="caption-group"><span>w</span></div>' };
    let answer: (r: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    boot([A1, B], root);
    await tick();
    const swapping = window.__hfSwapScenes!(preview([captions, B]).html);
    window.__hfRuntimeTeardown?.();
    answer(new Response("null", { status: 404 }));
    await expect(swapping).rejects.toThrow("torn down");
    delete (window as unknown as { gsap?: unknown }).gsap;
  });
});

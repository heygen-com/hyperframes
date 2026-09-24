import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { resetRuntimeDataForTests } from "./runtimeData";

function createMockTimeline(duration: number): RuntimeTimelineLike & { kill: () => void } {
  const s = { time: 0, paused: true, duration };
  return {
    play: () => void (s.paused = false),
    pause: () => void (s.paused = true),
    seek: (t?: number) => (t !== undefined && (s.time = t), s.time),
    totalTime: (t?: number) => (t !== undefined && (s.time = t), s.time),
    time: () => s.time,
    duration: () => s.duration,
    add: () => {},
    paused: (v?: boolean) => (typeof v === "boolean" && (s.paused = v), s.paused),
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
    kill: vi.fn(),
  } as RuntimeTimelineLike & { kill: () => void };
}

function trackingRoot(duration: number) {
  const children: unknown[] = [];
  const root = createMockTimeline(duration) as RuntimeTimelineLike & {
    remove: (c: unknown) => void;
  };
  root.add = ((child: unknown) => void children.push(child)) as RuntimeTimelineLike["add"];
  root.getChildren = (() => [...children]) as RuntimeTimelineLike["getChildren"];
  root.remove = (child) => {
    const i = children.indexOf(child);
    if (i >= 0) children.splice(i, 1);
  };
  return { root, children };
}

function film() {
  const rootEl = document.createElement("div");
  rootEl.setAttribute("data-composition-id", "main");
  rootEl.setAttribute("data-root", "true");
  rootEl.setAttribute("data-start", "0");
  rootEl.setAttribute("data-duration", "6");
  document.body.appendChild(rootEl);
  return rootEl;
}

function addHost(rootEl: Element, id: string | null, src: string, start = 1) {
  const host = document.createElement("div");
  if (id) host.setAttribute("data-composition-id", id);
  host.setAttribute("data-composition-src", src);
  host.setAttribute("data-start", String(start));
  host.setAttribute("data-duration", "2");
  rootEl.appendChild(host);
  return host;
}

const tick = () => new Promise<void>((r) => window.setTimeout(r, 0));
const SRC = "https://example.com/sub.html";
const sceneHtml = (body: string) =>
  `<html><body><template id="sub-template"><style>.sub-probe { color: red; }</style><div data-composition-id="sub">${body}</div></template></body></html>`;
const probeStyles = () =>
  [...document.head.querySelectorAll("style")].filter((s) =>
    (s.textContent ?? "").includes("sub-probe"),
  );

describe("__hfRemountComposition under hostile orderings", () => {
  beforeEach(() => {
    resetRuntimeDataForTests();
    document.body.innerHTML = "";
    (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (v: string) => v;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => (
      cb(0), 1
    )) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });
  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    vi.restoreAllMocks();
  });

  it("rejects when the scene file cannot be fetched, so the caller reloads", async () => {
    const { root, children } = trackingRoot(6);
    const before = createMockTimeline(2);
    let fail = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (fail) return new Response("gone", { status: 500 });
      window.__timelines!.sub = before;
      return new Response(sceneHtml("<p>Before</p>"), { status: 200 });
    });
    addHost(film(), "sub", SRC);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    await tick();
    expect(children).toEqual([before]);
    fail = true;
    let outcome = "resolved";
    await window.__hfRemountComposition!(SRC).catch(() => (outcome = "rejected"));
    expect(outcome).toBe("rejected");
  });

  it("mounts once when a remount arrives while the boot mount of that scene is in flight", async () => {
    const { root } = trackingRoot(6);
    const pending: Array<() => void> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((res) =>
          pending.push(() => res(new Response(sceneHtml("<p>S</p>"), { status: 200 }))),
        ),
    );
    const host = addHost(film(), "sub", SRC);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    const p = window.__hfRemountComposition!(SRC);
    await vi.waitFor(() => expect(pending.length).toBe(1));
    pending[0]!();
    await vi.waitFor(() => expect(pending.length).toBe(2));
    pending[1]!();
    await p;
    expect(host.querySelectorAll("p").length).toBe(1);
    expect(probeStyles().length).toBe(1);
  });

  it("mounts once for two overlapping remounts of the same scene (two quick saves)", async () => {
    const { root } = trackingRoot(6);
    const pending: Array<() => void> = [];
    let boot = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      if (boot) return Promise.resolve(new Response(sceneHtml("<p>S</p>"), { status: 200 }));
      return new Promise<Response>((res) =>
        pending.push(() => res(new Response(sceneHtml("<p>S</p>"), { status: 200 }))),
      );
    });
    const host = addHost(film(), "sub", SRC);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    await tick();
    boot = false;
    const a = window.__hfRemountComposition!(SRC);
    const b = window.__hfRemountComposition!(SRC);
    await vi.waitFor(() => expect(pending.length).toBe(1));
    pending[0]!();
    await vi.waitFor(() => expect(pending.length).toBe(2));
    pending[1]!();
    await Promise.all([a, b]);
    expect(host.querySelectorAll("p").length).toBe(1);
    expect(probeStyles().length).toBe(1);
  });

  it("applies stored position edits inside the remounted scene, as boot does", async () => {
    const { root } = trackingRoot(6);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          sceneHtml(
            '<div id="box" data-x="100" data-y="0" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>',
          ),
          { status: 200 },
        ),
    );
    addHost(film(), "sub", SRC);
    window.__timelines = { main: root, sub: createMockTimeline(2) };
    initSandboxRuntimeModular();
    await tick();
    const bootTranslate = (document.getElementById("box") as HTMLElement).style.translate;
    await window.__hfRemountComposition!(SRC);
    expect(bootTranslate).toBe("100px 0px");
    expect((document.getElementById("box") as HTMLElement).style.translate).toBe("100px 0px");
  });

  it("rejects, touching no timeline, when a late host shares the scene id", async () => {
    const { root } = trackingRoot(6);
    const made: Array<ReturnType<typeof createMockTimeline>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const tl = createMockTimeline(2);
      made.push(tl);
      window.__timelines!.sub = tl;
      return new Response(sceneHtml("<p>S</p>"), { status: 200 });
    });
    const rootEl = film();
    addHost(rootEl, "sub", SRC, 0);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    await tick();
    addHost(rootEl, "sub", SRC, 3);
    await expect(window.__hfRemountComposition!(SRC)).rejects.toThrow("missing or shared");
    expect(made[0]!.kill).not.toHaveBeenCalled();
  });

  it("rejects for a host with no id, leaving its timeline in place", async () => {
    const { root, children } = trackingRoot(6);
    const made: Array<ReturnType<typeof createMockTimeline>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const tl = createMockTimeline(2);
      made.push(tl);
      window.__timelines!.anon = tl;
      return new Response(
        `<html><body><template><div data-composition-id="anon"><p>A</p></div></template></body></html>`,
        { status: 200 },
      );
    });
    addHost(film(), null, SRC);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    await tick();
    await expect(window.__hfRemountComposition!(SRC)).rejects.toThrow("missing or shared");
    expect(children).toEqual([made[0]]);
  });

  it("teardown after a remount removes the styles the remount injected", async () => {
    const { root } = trackingRoot(6);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(sceneHtml("<p>S</p>"), { status: 200 }),
    );
    addHost(film(), "sub", SRC);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    await tick();
    await window.__hfRemountComposition!(SRC);
    expect(probeStyles().length).toBe(1);
    window.__hfRuntimeTeardown?.();
    expect(probeStyles().length).toBe(0);
  });

  it("stops and releases the replaced scene's media", async () => {
    const { root } = trackingRoot(6);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(sceneHtml('<video class="clip" src="https://example.com/a.mp4"></video>'), {
          status: 200,
        }),
    );
    const host = addHost(film(), "sub", SRC);
    window.__timelines = { main: root };
    initSandboxRuntimeModular();
    await tick();
    const old = host.querySelector("video")!;
    await window.__hfRemountComposition!(SRC);
    expect(host.querySelector("video")).not.toBe(old);
    expect(old.hasAttribute("src")).toBe(false);
  });
});

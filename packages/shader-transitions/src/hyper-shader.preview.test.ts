// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./hyper-shader.js";

// The slice of a paused GSAP timeline that init() drives: time() fires the callbacks it
// crosses unless events are suppressed, then onUpdate.
function stubGsap() {
  let now = 0;
  let onUpdate: (() => void) | undefined;
  let paused = true;
  const calls: { fn: () => void; at: number }[] = [];
  const tl = {
    paused: () => paused,
    play: () => ((paused = false), tl),
    pause: () => ((paused = true), tl),
    time: (t?: number, suppressEvents = false) => {
      if (t === undefined) return now;
      const from = now;
      now = t;
      if (!suppressEvents) {
        for (const { fn, at } of calls) {
          if ((from < at && at <= t) || (t < at && at <= from)) fn();
        }
      }
      onUpdate?.();
      return tl;
    },
    seek: (t: number) => tl.time(t),
    call: (fn: () => void, _args: null, at: number) => (calls.push({ fn, at }), tl),
    set: () => tl,
    to: () => tl,
    fromTo: () => tl,
  };
  const timeline = (opts: { onUpdate?: () => void }) => ((onUpdate = opts.onUpdate), tl);
  vi.stubGlobal("gsap", { timeline, set: () => {}, to: () => {}, fromTo: () => {} });
}

function stubWebGl() {
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  const gl = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "getShaderParameter" || key === "getProgramParameter" ? () => true : () => ({}),
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((type: string) =>
    type === "webgl" ? gl : null) as HTMLCanvasElement["getContext"]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

type ShaderTimeline = ReturnType<typeof init> & {
  call: (fn: () => void, args: null, at: number) => unknown;
};

function mountScenes(ids: string[]): void {
  document.body.innerHTML = `<div data-composition-id="main" data-width="640" data-height="360">${ids
    .map((id) => `<div id="${id}" class="scene clip">${id}</div>`)
    .join("")}</div>`;
}

function prewarmDone(): Promise<void> {
  return (window as unknown as { __hf: { shaderTransitionsReady: Promise<void> } }).__hf
    .shaderTransitionsReady;
}

function visibilityOf(ids: string[]): string[] {
  return ids.map((id) => (document.getElementById(id) as HTMLElement).style.visibility);
}

describe("preview outside a transition", () => {
  it("leaves the runtime's hide on shader scenes after the prewarm on a paused page", async () => {
    stubGsap();
    stubWebGl();
    // jsdom cannot capture a scene; HyperShader falls back to a CSS crossfade and warns.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let prewarmedTransitions = 0;
    window.addEventListener("hyperShader:ready", (e) => {
      prewarmedTransitions = (e as CustomEvent<{ total: number }>).detail.total;
    });
    mountScenes(["s4", "s5"]);
    const tl = init({
      bgColor: "#000",
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
    });
    // The runtime starts after the film's script and hides both while the prewarm runs.
    await Promise.resolve();
    for (const id of ["s4", "s5"]) {
      (document.getElementById(id) as HTMLElement).style.visibility = "hidden";
    }
    await prewarmDone();

    // Paused: nothing re-syncs visibility until the next seek.
    tl.time(0);
    expect(prewarmedTransitions).toBeGreaterThan(0);
    expect(visibilityOf(["s4", "s5"])).toEqual(["hidden", "hidden"]);
  });

  it("does not leave a scene outside the transition pair hidden", async () => {
    stubGsap();
    stubWebGl();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mountScenes(["s1", "s2", "s3"]);
    const tl = init({
      bgColor: "#000",
      scenes: ["s1", "s2", "s3"],
      transitions: [
        { time: 2, duration: 0.8, shader: "domain-warp" },
        { time: 4, duration: 0.8, shader: "domain-warp" },
      ],
    });
    await prewarmDone();

    tl.time(4.2);
    tl.time(1, true);
    expect(visibilityOf(["s1"])).not.toEqual(["hidden"]);
  });

  it("keeps seeking after a timeline callback throws during the prewarm's restore seek", async () => {
    stubGsap();
    stubWebGl();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mountScenes(["s4", "s5"]);
    const tl = init({
      bgColor: "#000",
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
    }) as ShaderTimeline;
    let throwing = true;
    tl.call(
      () => {
        if (throwing) throw new Error("author callback");
      },
      null,
      1,
    );
    let hits = 0;
    tl.call(() => (hits += 1), null, 3);
    await prewarmDone().catch(() => {});
    throwing = false;
    hits = 0;

    tl.time(3.5);
    expect(hits).toBe(1);
  });
});

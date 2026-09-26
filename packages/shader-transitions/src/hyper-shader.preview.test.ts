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

describe("preview outside a transition", () => {
  it("leaves the runtime's hide on shader scenes after the prewarm on a paused page", async () => {
    stubGsap();
    stubWebGl();
    // jsdom cannot capture a scene; HyperShader falls back to a CSS crossfade and warns.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // s4 runs 2.8 to 4.8 s and s5 4.4 to 8.0 s.
    document.body.innerHTML = `<div data-composition-id="main" data-width="640" data-height="360">
      <div id="s1" class="scene clip">one</div>
      <div id="s4" class="scene clip">four</div>
      <div id="s5" class="scene clip">five</div>
    </div>`;
    const tl = init({
      bgColor: "#000",
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
    });
    // The runtime starts after the film's script and hides both while the prewarm runs.
    for (const id of ["s4", "s5"]) {
      (document.getElementById(id) as HTMLElement).style.visibility = "hidden";
    }
    await (window as unknown as { __hf: { shaderTransitionsReady: Promise<void> } }).__hf
      .shaderTransitionsReady;

    // Paused: nothing re-syncs visibility until the next seek.
    tl.time(0);
    for (const id of ["s4", "s5"]) {
      expect(document.getElementById(id)?.style.visibility).toBe("hidden");
    }
  });
});

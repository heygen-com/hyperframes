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
    paused: (value?: boolean) =>
      value === undefined ? paused : ((paused = value), tl.totalTime(now, true), tl),
    play: () => ((paused = false), tl),
    pause: () => ((paused = true), tl),
    // Like GSAP, time() and seek() move the playhead through totalTime().
    time: (t?: number, suppressEvents = false) =>
      t === undefined ? now : tl.totalTime(t, suppressEvents),
    totalTime: (t?: number, suppressEvents = false) => {
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
    timeScale: (scale?: number) => (scale === undefined ? 1 : (tl.totalTime(now, true), tl)),
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
    expect((document.getElementById("s1") as HTMLElement).style.opacity).toBe("0");
    tl.time(1, true);
    expect(visibilityOf(["s1"])).not.toEqual(["hidden"]);
  });

  it("finishes the prewarm and keeps seeking after a timeline callback throws while it restores", async () => {
    stubGsap();
    stubWebGl();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    await prewarmDone();
    throwing = false;
    hits = 0;

    tl.time(3.5);
    expect(hits).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("restoring the playhead"),
      expect.objectContaining({ message: "author callback" }),
    );
  });
});

type SpeedTimeline = ShaderTimeline & {
  timeScale: (scale?: number) => unknown;
  totalTime: (t?: number) => unknown;
};

describe("a runtime seek while the prewarm runs", () => {
  it("is where the prewarm leaves the playhead", async () => {
    stubGsap();
    stubWebGl();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mountScenes(["s4", "s5"]);
    const tl = init({
      bgColor: "#000",
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
    }) as ShaderTimeline & { totalTime: (t?: number) => unknown };
    let crossings = 0;
    tl.call(() => (crossings += 1), null, 0.5);
    await Promise.resolve();
    tl.totalTime(1);
    await prewarmDone();
    crossings = 0;

    expect(tl.totalTime()).toBe(1);
    tl.time(0.2);
    expect(crossings).toBe(1);
  });

  it("is not moved by a speed change while the prewarm sits on a capture frame", async () => {
    stubGsap();
    stubWebGl();
    let tl: SpeedTimeline | undefined;
    let changedSpeed = false;
    vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
      if (!changedSpeed && String(message).includes("Transition capture failed")) {
        changedSpeed = true;
        tl?.timeScale(2);
      }
    });
    mountScenes(["s4", "s5"]);
    tl = init({
      bgColor: "#000",
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
    }) as unknown as SpeedTimeline;
    await prewarmDone();

    expect(changedSpeed).toBe(true);
    expect(tl?.totalTime()).toBe(0);
  });

  function initDuringCapture(onCaptureFrame: (tl: SpeedTimeline) => void): SpeedTimeline {
    stubGsap();
    stubWebGl();
    let tl: SpeedTimeline | undefined;
    let fired = false;
    vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
      if (!fired && tl && String(message).includes("Transition capture failed")) {
        fired = true;
        onCaptureFrame(tl);
      }
    });
    mountScenes(["s4", "s5"]);
    tl = init({
      bgColor: "#000",
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
    }) as unknown as SpeedTimeline;
    return tl;
  }

  it("applies it, reads back the recorded playhead, and restores to it", async () => {
    let readBeforeSeek: unknown;
    let crossedTwo = 0;
    let appliedAtOnce = false;
    const tl = initDuringCapture((timeline) => {
      readBeforeSeek = timeline.totalTime();
      crossedTwo = 0;
      timeline.totalTime(1);
      appliedAtOnce = crossedTwo === 1;
    });
    tl.call(() => (crossedTwo += 1), null, 2);
    await prewarmDone();

    expect(readBeforeSeek).toBe(0);
    expect(appliedAtOnce).toBe(true);
    expect(tl.totalTime()).toBe(1);
  });

  it("is not moved by paused(false) while the prewarm sits on a capture frame", async () => {
    const tl = initDuringCapture((timeline) => {
      (timeline as unknown as { paused: (value: boolean) => unknown }).paused(false);
    });
    await prewarmDone();

    expect(tl.totalTime()).toBe(0);
  });

  it("passes a seek after the prewarm straight through", async () => {
    const tl = initDuringCapture(() => {});
    let crossedThree = 0;
    tl.call(() => (crossedThree += 1), null, 3);
    await prewarmDone();
    crossedThree = 0;

    tl.totalTime(3.5);
    expect(crossedThree).toBe(1);
  });
});

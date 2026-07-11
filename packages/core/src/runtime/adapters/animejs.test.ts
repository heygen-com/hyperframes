// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnimeJsAdapter, installHyperframesAnimeApi } from "./animejs";
import type { RuntimeAnimeApi, RuntimeAnimeRegistry } from "../types";

type TestAnimeInstance = {
  seek: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  duration?: number | (() => number);
  totalDuration?: number | (() => number);
};

type TestAnimeTimeline = {
  add?: ReturnType<typeof vi.fn>;
};

type TestAnimeWindow = Window & {
  anime?: {
    createTimeline?: () => TestAnimeTimeline;
    animate?: () => unknown;
    running?: unknown[];
  };
  __hfAnime?: RuntimeAnimeRegistry | TestAnimeInstance[];
  hyperframesAnime?: RuntimeAnimeApi;
};

const animeWindow: TestAnimeWindow = window;

function createAnimeInstance(opts?: { duration?: number | (() => number) }): TestAnimeInstance {
  return {
    seek: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    duration: opts?.duration ?? 2000,
  };
}

function registerInstancePair() {
  const a = createAnimeInstance();
  const b = createAnimeInstance();
  installHyperframesAnimeApi();
  animeWindow.hyperframesAnime?.register("a", a);
  animeWindow.hyperframesAnime?.register("b", b);
  return { a, b, adapter: createAnimeJsAdapter() };
}

describe("animejs adapter", () => {
  beforeEach(() => {
    delete animeWindow.anime;
    delete animeWindow.__hfAnime;
    delete animeWindow.hyperframesAnime;
  });

  afterEach(() => {
    delete animeWindow.anime;
    delete animeWindow.__hfAnime;
    delete animeWindow.hyperframesAnime;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    expect(createAnimeJsAdapter().name).toBe("animejs");
  });

  describe("registration helper", () => {
    it("registers keyed anime instances on window.__hfAnime", () => {
      const instance = createAnimeInstance();

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance, {
        labels: { intro: 0.5, outro: 1.75 },
      });

      const entry = animeWindow.hyperframesAnime?.get("main");
      expect(entry?.instance).toBe(instance);
      expect(entry?.labels).toEqual({ intro: 0.5, outro: 1.75 });
      expect(animeWindow.hyperframesAnime?.resolveLabel("main", "outro")).toBe(1.75);
    });

    it("keeps the last registration for duplicate ids and warns", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const first = createAnimeInstance();
      const second = createAnimeInstance();

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", first);
      animeWindow.hyperframesAnime?.register("main", second);

      expect(animeWindow.hyperframesAnime?.get("main")?.instance).toBe(second);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[hyperframes] Replacing anime.js registration "main"'),
      );
    });

    it("preserves legacy array registrations", () => {
      const legacy = createAnimeInstance();
      animeWindow.__hfAnime = [legacy];

      installHyperframesAnimeApi();

      expect(animeWindow.hyperframesAnime?.entries().map((entry) => entry.instance)).toContain(
        legacy,
      );
    });

    it("leaves legacy push registration available when installed before composition scripts", () => {
      const legacy = createAnimeInstance();

      installHyperframesAnimeApi();

      expect(Array.isArray(animeWindow.__hfAnime)).toBe(true);
      if (Array.isArray(animeWindow.__hfAnime)) {
        animeWindow.__hfAnime.push(legacy);
      }
      expect(animeWindow.hyperframesAnime?.entries().map((entry) => entry.instance)).toContain(
        legacy,
      );
    });
  });

  describe("discover", () => {
    it("installs the registration helper without relying on anime.running", () => {
      animeWindow.anime = {
        createTimeline: () => ({}),
        animate: () => ({}),
      };
      const adapter = createAnimeJsAdapter();

      expect(() => adapter.discover()).not.toThrow();

      expect(animeWindow.hyperframesAnime).toBeDefined();
      expect(animeWindow.__hfAnime).toBeDefined();
    });
  });

  describe("priming (U1 fix for U3 gate cold-seek bug)", () => {
    it("primes a fresh registered instance to duration then back to zero before real seeks", () => {
      const instance = createAnimeInstance({ duration: 4000 });

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);

      expect(instance.seek.mock.calls).toEqual([
        [4000, true],
        [0, true],
      ]);
    });

    it("does not double-prime registered instances when later collected", () => {
      const instance = createAnimeInstance({ duration: 4000 });
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      instance.seek.mockClear();
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 1 });

      expect(instance.seek.mock.calls).toEqual([[1000]]);
    });

    it("primes legacy array registrations on first collection before the real seek", () => {
      const legacy = createAnimeInstance({ duration: 4400 });
      animeWindow.__hfAnime = [legacy];
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 0 });

      expect(legacy.seek.mock.calls).toEqual([[4400, true], [0, true], [0]]);
    });

    it("regresses the U3 gate backward-seek cold seek for late-position children", () => {
      const rawState = "untouched";
      const fromState = "rotate(-8deg) translateY(90px)";
      let renderedState = rawState;
      let engaged = false;
      const instance = {
        duration: 4400,
        seek: vi.fn((timeMs: number) => {
          if (timeMs >= 1200) engaged = true;
          renderedState = engaged ? fromState : rawState;
        }),
      };

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      createAnimeJsAdapter().seek({ time: 0 });

      expect(renderedState).toBe(fromState);
    });

    it("keeps numeric from-values written during priming when later seek(0) is unchanged", () => {
      document.body.innerHTML = '<div id="card"></div>';
      const card = document.getElementById("card");
      expect(card).not.toBeNull();
      if (!card) return;

      let engaged = false;
      let currentTimeMs: number | null = null;
      const instance = {
        duration: 4000,
        seek: vi.fn((timeMs: number) => {
          if (timeMs === currentTimeMs) return;
          currentTimeMs = timeMs;
          if (timeMs >= 1200) engaged = true;
          if (engaged) {
            card.style.opacity = "0";
            card.style.transform = "translateY(400px)";
          }
        }),
      };

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      createAnimeJsAdapter().seek({ time: 0 });

      expect(card.style.opacity).toBe("0");
      expect(card.style.transform).toBe("translateY(400px)");
    });

    it("does not strand a visibility-only set from priming at frame zero", () => {
      document.body.innerHTML = '<div id="card"></div>';
      const card = document.getElementById("card");
      expect(card).not.toBeNull();
      if (!card) return;

      const instance = {
        duration: 4000,
        seek: vi.fn((timeMs: number) => {
          if (timeMs >= 4000) {
            card.style.visibility = "hidden";
          }
        }),
      };

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      createAnimeJsAdapter().seek({ time: 0 });

      expect(card.style.visibility).toBe("");
    });

    it("restores late-only primed style properties before their first keyframe", () => {
      document.body.innerHTML = '<div id="scene1"></div>';
      const scene = document.getElementById("scene1");
      expect(scene).not.toBeNull();
      if (!scene) return;

      const clipTween = {
        target: scene,
        property: "clipPath",
        _absoluteStartTime: 3000,
        _hasFromValue: 0,
        _next: null,
      };
      const fadeOutTween = {
        target: scene,
        property: "opacity",
        _absoluteStartTime: 4750,
        _hasFromValue: 0,
        _next: clipTween,
      };
      const fadeInTween = {
        target: scene,
        property: "opacity",
        _absoluteStartTime: 3000,
        _hasFromValue: 0,
        _next: fadeOutTween,
      };
      const timelineChild = {
        _head: fadeInTween,
        _next: null,
      };
      const instance = {
        duration: 5000,
        _head: timelineChild,
        seek: vi.fn((timeMs: number) => {
          if (timeMs >= 4750) {
            scene.style.opacity = "0";
            scene.style.setProperty("clip-path", "inset(100% 0 0 0)");
          }
        }),
      };

      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      createAnimeJsAdapter().seek({ time: 2.844 });

      expect(scene.style.opacity).toBe("");
      expect(scene.style.getPropertyValue("clip-path")).toBe("");
    });

    it("does not fire tl.call()/onComplete side effects during the priming seek, only on a real seek that reaches that position", () => {
      let statusText = "pending";
      const children: Array<{ position: number; onComplete?: () => void; fired: boolean }> = [];
      const timelineImpl: Record<string, unknown> = {
        add: vi.fn((_targets: unknown, params: unknown, position?: unknown) => {
          const { onComplete } = params as { onComplete?: () => void };
          children.push({ position: Number(position) || 0, onComplete, fired: false });
          return timelineImpl;
        }),
        // Mirrors real anime.js: a muted seek (muteCallbacks=true) skips
        // completion bookkeeping and callback firing entirely, so it neither
        // fires the callback now nor blocks a later unmuted seek from firing
        // it once the (still uncompleted) position is reached for real.
        seek: vi.fn((timeMs: number, muteCallbacks?: boolean) => {
          if (muteCallbacks) return;
          for (const child of children) {
            if (!child.fired && timeMs >= child.position) {
              child.fired = true;
              child.onComplete?.();
            }
          }
        }),
      };
      animeWindow.anime = { createTimeline: () => timelineImpl as TestAnimeTimeline };

      installHyperframesAnimeApi();
      const timeline = animeWindow.anime.createTimeline?.() as unknown as {
        add: (targets: unknown, params: unknown, position: unknown) => unknown;
      };
      // Sugar for tl.call(fn, 5.2s): a zero-duration tween whose onComplete
      // mutates DOM state, exactly what liquid-glass-widgets' tl.call() and
      // flowchart's addTimelineCall() helper both do.
      timeline.add({}, { duration: 0, onComplete: () => (statusText = "Preview ready") }, 5200);

      animeWindow.hyperframesAnime?.register("main", timelineImpl as unknown as TestAnimeInstance);

      // Registration primes the timeline by seeking to its (fallback) full
      // duration and back to 0; the callback must not fire as a side effect.
      expect(statusText).toBe("pending");

      // A real seek that reaches the callback's position still fires it.
      createAnimeJsAdapter().seek({ time: 5.2 });
      expect(statusText).toBe("Preview ready");
    });
  });

  describe("seek", () => {
    it("seeks keyed instances with time in milliseconds", () => {
      const instance = createAnimeInstance();
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 2 });

      expect(instance.seek).toHaveBeenCalledWith(2000);
    });

    it("seeks fractional seconds accurately", () => {
      const instance = createAnimeInstance();
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 0.5 });

      expect(instance.seek).toHaveBeenCalledWith(500);
    });

    it("clamps negative time to 0", () => {
      const instance = createAnimeInstance();
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", instance);
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: -3 });

      expect(instance.seek).toHaveBeenCalledWith(0);
    });

    it("does nothing with no instances", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.seek({ time: 1 })).not.toThrow();
    });

    it("seeks multiple keyed instances", () => {
      const { a, b, adapter } = registerInstancePair();

      adapter.seek({ time: 1.5 });

      expect(a.seek).toHaveBeenCalledWith(1500);
      expect(b.seek).toHaveBeenCalledWith(1500);
    });

    it("seeks sub-composition instances using local time offset by the host start", () => {
      document.body.innerHTML = `
        <div data-composition-id="root" data-start="0" data-duration="20">
          <div data-composition-id="scene2-4-canvas" data-start="1.5" data-duration="12.5"></div>
        </div>
      `;
      const root = createAnimeInstance({ duration: 20_000 });
      const subComposition = createAnimeInstance({ duration: 12_500 });
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("root", root);
      animeWindow.hyperframesAnime?.register("scene2-4-canvas", subComposition);
      root.seek.mockClear();
      subComposition.seek.mockClear();
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 1.6 });

      expect(root.seek).toHaveBeenCalledWith(1600);
      expect(subComposition.seek).toHaveBeenCalledWith(100);
    });

    it("continues seeking remaining instances if one throws", () => {
      const bad = {
        seek: vi.fn(() => {
          throw new Error("boom");
        }),
        pause: vi.fn(),
        play: vi.fn(),
      };
      const good = createAnimeInstance();
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("bad", bad);
      animeWindow.hyperframesAnime?.register("good", good);
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 1 });

      expect(good.seek).toHaveBeenCalledWith(1000);
    });

    it("seeks legacy array registrations", () => {
      const legacy = createAnimeInstance();
      animeWindow.__hfAnime = [legacy];
      const adapter = createAnimeJsAdapter();

      adapter.seek({ time: 1.25 });

      expect(legacy.seek).toHaveBeenCalledWith(1250);
    });
  });

  describe("pause", () => {
    it("pauses all keyed instances", () => {
      const { a, b, adapter } = registerInstancePair();

      adapter.pause();

      expect(a.pause).toHaveBeenCalled();
      expect(b.pause).toHaveBeenCalled();
    });

    it("does nothing with no instances", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.pause()).not.toThrow();
    });
  });

  describe("play", () => {
    it("plays all keyed instances", () => {
      const a = createAnimeInstance();
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("a", a);
      const adapter = createAnimeJsAdapter();

      adapter.play?.();

      expect(a.play).toHaveBeenCalled();
    });
  });

  describe("duration inference", () => {
    it("returns the longest finite registered duration in seconds", () => {
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("short", createAnimeInstance({ duration: 1200 }));
      animeWindow.hyperframesAnime?.register("long", createAnimeInstance({ duration: 3200 }));
      const adapter = createAnimeJsAdapter();

      expect(adapter.getInferredDurationSeconds?.()).toBe(3.2);
    });

    it("supports duration functions", () => {
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register("main", createAnimeInstance({ duration: () => 2500 }));
      const adapter = createAnimeJsAdapter();

      expect(adapter.getInferredDurationSeconds?.()).toBe(2.5);
    });

    it("ignores infinite durations so no-duration comps fail through the readiness guard", () => {
      installHyperframesAnimeApi();
      animeWindow.hyperframesAnime?.register(
        "loop",
        createAnimeInstance({ duration: Number.POSITIVE_INFINITY }),
      );
      const adapter = createAnimeJsAdapter();

      expect(adapter.getInferredDurationSeconds?.()).toBeNull();
    });
  });

  describe("revert", () => {
    it("does not throw", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.revert?.()).not.toThrow();
    });
  });

  it("rewrites clip-path none only after a circle tween on the same target", () => {
    const fakeAdd = vi.fn();
    const fakeTimeline: TestAnimeTimeline = { add: fakeAdd };
    fakeAdd.mockReturnValue(fakeTimeline);
    animeWindow.anime = { createTimeline: () => fakeTimeline };

    installHyperframesAnimeApi();
    const timeline = animeWindow.anime.createTimeline?.();
    expect(timeline?.add).toBeTypeOf("function");
    if (!timeline?.add) return;

    const element = document.createElement("div");
    element.id = "the-id";
    const freshElement = document.createElement("div");
    freshElement.id = "fresh-id";
    document.body.append(element, freshElement);

    const circleParams = { clipPath: "circle(75% at 50% 50%)" };
    timeline.add("#the-id", circleParams, 0);
    expect(fakeAdd).toHaveBeenNthCalledWith(1, "#the-id", circleParams, 0);
    expect(circleParams).toEqual({ clipPath: "circle(75% at 50% 50%)" });

    timeline.add("#the-id", { clipPath: "none", duration: 0 }, 100);
    expect(fakeAdd).toHaveBeenNthCalledWith(
      2,
      "#the-id",
      { clipPath: "circle(150% at 50% 50%)", duration: 0 },
      100,
    );

    timeline.add("#fresh-id", { clipPath: "none" }, 0);
    expect(fakeAdd).toHaveBeenNthCalledWith(3, "#fresh-id", { clipPath: "none" }, 0);

    element.remove();
    freshElement.remove();
  });

  it("only corrects the earliest implicit transform tween for a target property", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        a = 1;
        b = 0;
        c = 0;
        d = 1;
        e = 120;
        f = 0;
      },
    );
    const element = document.createElement("div");
    element.style.transform = "matrix(1, 0, 0, 1, 120, 0)";
    document.body.append(element);
    const laterTween = {
      target: element,
      property: "translateX",
      _hasFromValue: 0,
      _fromNumber: 0,
      _number: 0,
      _unit: "px",
      _absoluteStartTime: 0.0001,
      _next: null,
    };
    const earliestTween = {
      target: element,
      property: "translateX",
      _hasFromValue: 0,
      _fromNumber: -960,
      _number: -960,
      _unit: "px",
      _absoluteStartTime: 0,
      _next: laterTween,
    };
    const instance = {
      _head: earliestTween,
      seek: vi.fn(),
    };

    installHyperframesAnimeApi();
    animeWindow.hyperframesAnime?.register("test-earliest-transform", instance);

    expect(earliestTween._fromNumber).toBe(120);
    expect(earliestTween._number).toBe(120);
    expect(laterTween._fromNumber).toBe(0);
    expect(laterTween._number).toBe(0);
    element.remove();
  });

  it("leaves an implicit transform tween alone when an earlier explicit tween owns the property", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        a = 1;
        b = 0;
        c = 0;
        d = 1;
        e = 120;
        f = 0;
      },
    );
    const element = document.createElement("div");
    element.style.transform = "matrix(1, 0, 0, 1, 120, 0)";
    document.body.append(element);
    // Stacked pattern from registry/blocks/apple-money-count: an explicit
    // [0, y] burst tween followed by an implicit-from fade tween that anime.js
    // chains from the burst's end value. The implicit tween must NOT be
    // rewritten to the CSS-cascade value.
    const implicitFade = {
      target: element,
      property: "translateX",
      _hasFromValue: 0,
      _fromNumber: 340,
      _number: 340,
      _unit: "px",
      _absoluteStartTime: 4180,
      _next: null,
    };
    const explicitBurst = {
      target: element,
      property: "translateX",
      _hasFromValue: 1,
      _fromNumber: 0,
      _number: 0,
      _unit: "px",
      _absoluteStartTime: 3280,
      _next: implicitFade,
    };
    const instance = {
      _head: explicitBurst,
      seek: vi.fn(),
    };

    installHyperframesAnimeApi();
    animeWindow.hyperframesAnime?.register("test-explicit-owns-property", instance);

    expect(explicitBurst._fromNumber).toBe(0);
    expect(implicitFade._fromNumber).toBe(340);
    expect(implicitFade._number).toBe(340);
    element.remove();
  });

  // jsdom does not provide DOMMatrixReadOnly, so browser transform decomposition is unavailable.
  it.skip("corrects implicit transform from-values from the CSS-cascaded transform", () => {
    const element = document.createElement("div");
    element.style.transform = "matrix(0, 0, 0, 0, -50, -30)";
    document.body.append(element);
    const tween = {
      target: element,
      property: "scale",
      _hasFromValue: 0,
      _fromNumber: 1,
      _number: 1,
      _unit: null,
      _absoluteStartTime: 0,
      _next: null,
    };
    const instance = {
      _head: tween,
      seek: vi.fn(),
    };

    installHyperframesAnimeApi();
    animeWindow.hyperframesAnime?.register("test-family-a", instance);

    expect(tween._fromNumber).toBe(0);
    expect(tween._number).toBe(0);
  });
});

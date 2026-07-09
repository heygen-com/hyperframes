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

type TestAnimeWindow = Window & {
  anime?: {
    createTimeline?: () => unknown;
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

      expect(instance.seek.mock.calls).toEqual([[4000], [0]]);
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

      expect(legacy.seek.mock.calls).toEqual([[4400], [0], [0]]);
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
});

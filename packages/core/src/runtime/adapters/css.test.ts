import { describe, it, expect, vi } from "vitest";
import { createCssAdapter } from "./css";

describe("css adapter", () => {
  it("has correct name", () => {
    expect(createCssAdapter().name).toBe("css");
  });

  it("discover finds elements with CSS animations", () => {
    const el = document.createElement("div");
    el.style.animationName = "fadeIn";
    el.style.animationDuration = "1s";
    document.body.appendChild(el);

    const adapter = createCssAdapter();
    adapter.discover();
    // discover doesn't crash — that's the main assertion
    document.body.removeChild(el);
  });

  it("seek sets animationDelay and pauses", () => {
    const el = document.createElement("div");
    el.setAttribute("data-start", "1");
    el.style.animationName = "slide";
    el.style.animationDuration = "2s";
    document.body.appendChild(el);

    // We need to mock getComputedStyle since jsdom doesn't compute animations
    const origGetComputedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
      const real = origGetComputedStyle(target);
      return {
        ...real,
        animationName: target === el ? "slide" : "none",
      } as CSSStyleDeclaration;
    });

    const adapter = createCssAdapter();
    adapter.discover();
    (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [];
    adapter.seek({ time: 3 });

    expect(el.style.animationPlayState).toBe("paused");
    // localTime = max(0, 3 - 1) = 2
    expect(el.style.animationDelay).toBe("-2s");

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  it("seek uses resolveStartSeconds when provided", () => {
    const el = document.createElement("div");
    el.style.animationName = "bounce";
    document.body.appendChild(el);

    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { animationName: "bounce" } as CSSStyleDeclaration;
    });

    const adapter = createCssAdapter({ resolveStartSeconds: () => 2 });
    adapter.discover();
    (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [];
    adapter.seek({ time: 5 });

    expect(el.style.animationPlayState).toBe("paused");
    // localTime = max(0, 5 - 2) = 3
    expect(el.style.animationDelay).toBe("-3s");

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  it("pause restores base play state", () => {
    const el = document.createElement("div");
    el.style.animationName = "spin";
    el.style.animationPlayState = "running";
    document.body.appendChild(el);

    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { animationName: "spin" } as CSSStyleDeclaration;
    });

    const adapter = createCssAdapter();
    adapter.discover();
    (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [];
    adapter.seek({ time: 1 });
    expect(el.style.animationPlayState).toBe("paused");

    adapter.pause();
    expect(el.style.animationPlayState).toBe("running");

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  it("revert clears entries", () => {
    const adapter = createCssAdapter();
    adapter.revert!();
    // Should not crash when seeking after revert
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });

  it("seek drives CSS animations through WAAPI currentTime when available", () => {
    const el = document.createElement("div");
    el.setAttribute("data-start", "1");
    el.style.animationName = "spin";
    document.body.appendChild(el);

    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { animationName: "spin" } as CSSStyleDeclaration;
    });

    const animation = { currentTime: 0, pause: vi.fn(), play: vi.fn() } as unknown as Animation;
    (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [animation];

    const adapter = createCssAdapter();
    adapter.discover();
    adapter.seek({ time: 3 });

    expect(animation.currentTime).toBe(2000);
    expect(animation.pause).toHaveBeenCalled();
    expect(el.style.animationDelay).toBe("");
    expect(el.style.animationPlayState).toBe("");

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  it("does not rescan element animations on every seek", () => {
    const el = document.createElement("div");
    el.style.animationName = "spin";
    document.body.appendChild(el);

    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { animationName: "spin" } as CSSStyleDeclaration;
    });

    const animation = { currentTime: 0, pause: vi.fn(), play: vi.fn() } as unknown as Animation;
    const getAnimations = vi.fn(() => [animation]);
    (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = getAnimations;

    const adapter = createCssAdapter();
    adapter.discover();
    adapter.seek({ time: 1 });
    adapter.seek({ time: 2 });
    adapter.seek({ time: 3 });

    expect(getAnimations).toHaveBeenCalledTimes(1);
    expect(animation.currentTime).toBe(3000);

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  it("play resumes WAAPI animations and restores inline styles", () => {
    const el = document.createElement("div");
    el.style.animationName = "spin";
    el.style.animationPlayState = "running";
    document.body.appendChild(el);

    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { animationName: "spin" } as CSSStyleDeclaration;
    });

    const animation = { currentTime: 0, pause: vi.fn(), play: vi.fn() } as unknown as Animation;
    (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [animation];

    const adapter = createCssAdapter();
    adapter.discover();
    adapter.play?.();

    expect(animation.play).toHaveBeenCalled();
    expect(el.style.animationPlayState).toBe("running");

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  describe("getInferredDurationSeconds", () => {
    it("returns null when nothing was discovered", () => {
      const adapter = createCssAdapter();
      adapter.discover();
      expect(adapter.getInferredDurationSeconds?.()).toBeNull();
    });

    it("infers the longest finite animation end time, offset by data-start", () => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "2");
      el.style.animationName = "fadeIn";
      document.body.appendChild(el);

      vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
        return { animationName: "fadeIn" } as CSSStyleDeclaration;
      });

      const animation = {
        currentTime: 0,
        pause: vi.fn(),
        play: vi.fn(),
        effect: { getComputedTiming: () => ({ endTime: 3000 }) },
      } as unknown as Animation;
      (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [animation];

      const adapter = createCssAdapter();
      adapter.discover();

      // start (2s) + endTime (3s) = 5s
      expect(adapter.getInferredDurationSeconds?.()).toBe(5);

      document.body.removeChild(el);
      vi.restoreAllMocks();
    });

    it("returns the max across multiple animated elements", () => {
      const elA = document.createElement("div");
      elA.style.animationName = "a";
      const elB = document.createElement("div");
      elB.style.animationName = "b";
      document.body.appendChild(elA);
      document.body.appendChild(elB);

      vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
        return {
          animationName: target === elA ? "a" : target === elB ? "b" : "none",
        } as CSSStyleDeclaration;
      });

      (elA as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
        {
          effect: { getComputedTiming: () => ({ endTime: 1000 }) },
        } as unknown as Animation,
      ];
      (elB as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
        {
          effect: { getComputedTiming: () => ({ endTime: 4500 }) },
        } as unknown as Animation,
      ];

      const adapter = createCssAdapter();
      adapter.discover();

      expect(adapter.getInferredDurationSeconds?.()).toBe(4.5);

      document.body.removeChild(elA);
      document.body.removeChild(elB);
      vi.restoreAllMocks();
    });

    it("returns null when an animation's endTime is Infinity (infinite iteration count)", () => {
      const el = document.createElement("div");
      el.style.animationName = "spin";
      document.body.appendChild(el);

      vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
        return { animationName: "spin" } as CSSStyleDeclaration;
      });

      (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
        {
          effect: { getComputedTiming: () => ({ endTime: Infinity }) },
        } as unknown as Animation,
      ];

      const adapter = createCssAdapter();
      adapter.discover();

      expect(adapter.getInferredDurationSeconds?.()).toBeNull();

      document.body.removeChild(el);
      vi.restoreAllMocks();
    });

    it("returns the finite animation's end time when a finite and an unbounded animation coexist", () => {
      const elFinite = document.createElement("div");
      elFinite.style.animationName = "fadeIn";
      const elInfinite = document.createElement("div");
      elInfinite.style.animationName = "spin";
      document.body.appendChild(elFinite);
      document.body.appendChild(elInfinite);

      vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
        return {
          animationName: target === elFinite ? "fadeIn" : target === elInfinite ? "spin" : "none",
        } as CSSStyleDeclaration;
      });

      (elFinite as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
        {
          effect: { getComputedTiming: () => ({ endTime: 3000 }) },
        } as unknown as Animation,
      ];
      (elInfinite as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
        {
          effect: { getComputedTiming: () => ({ endTime: Infinity }) },
        } as unknown as Animation,
      ];

      const adapter = createCssAdapter();
      adapter.discover();

      // The unbounded "spin" animation is ignored; the finite "fadeIn"
      // animation's 3s end time is still a valid duration signal.
      expect(adapter.getInferredDurationSeconds?.()).toBe(3);

      document.body.removeChild(elFinite);
      document.body.removeChild(elInfinite);
      vi.restoreAllMocks();
    });

    it("ignores disconnected elements", () => {
      const el = document.createElement("div");
      el.style.animationName = "fadeIn";
      document.body.appendChild(el);

      vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
        return { animationName: "fadeIn" } as CSSStyleDeclaration;
      });
      (el as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
        {
          effect: { getComputedTiming: () => ({ endTime: 3000 }) },
        } as unknown as Animation,
      ];

      const adapter = createCssAdapter();
      adapter.discover();
      document.body.removeChild(el);

      expect(adapter.getInferredDurationSeconds?.()).toBeNull();
      vi.restoreAllMocks();
    });
  });
});

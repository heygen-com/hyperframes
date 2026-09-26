import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createCssAdapter } from "./css";

// jsdom has no Animation subclasses; the adapter tells them apart with instanceof CSSAnimation.
class FakeAnimation {}
class FakeCSSAnimation extends FakeAnimation {}
class FakeCSSTransition extends FakeAnimation {}

const makeAnimation = (target: Element, kind: typeof FakeAnimation = FakeCSSAnimation) =>
  Object.assign(new kind(), {
    currentTime: 0,
    pause: vi.fn(),
    play: vi.fn(),
    effect: { target },
  }) as unknown as Animation;

// The browser answers the same list per element and document-wide; returns a setter to replace it.
const mockLiveAnimations = (el: HTMLElement, initial: Animation[]) => {
  let live = initial;
  el.getAnimations = () => live;
  document.getAnimations = () => live;
  return (next: Animation[]) => {
    live = next;
  };
};

// Like the runtime's resolver, reads only the element it is handed.
const ownStart = (el: Element) => Number(el.getAttribute("data-start") ?? 0);

describe("css adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    vi.stubGlobal("CSSTransition", FakeCSSTransition);
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "getAnimations");
    vi.unstubAllGlobals();
  });

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

  it("pause keeps the fallback pose of an element with no live animation; play restores base", () => {
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

    // A render seeks, pauses, then shows the clip: the browser's new animation starts from this pose.
    adapter.pause();
    expect(el.style.animationPlayState).toBe("paused");
    expect(el.style.animationDelay).toBe("-1s");

    adapter.play?.();
    expect(el.style.animationPlayState).toBe("running");
    expect(el.style.animationDelay).toBe("");

    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  it("does not scan document animations when no element has a CSS animation", () => {
    const getAnimations = vi.fn(() => []);
    document.getAnimations = getAnimations;

    const adapter = createCssAdapter();
    adapter.discover();
    adapter.seek({ time: 1 });
    adapter.pause();

    expect(getAnimations).not.toHaveBeenCalled();
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

    const animation = makeAnimation(el);
    mockLiveAnimations(el, [animation]);

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

  describe("after the browser replaces an element's CSSAnimation", () => {
    const el = document.createElement("div");
    el.setAttribute("data-start", "1");
    el.style.animationName = "slide";

    const setup = (initial: Animation[]) => {
      document.body.appendChild(el);
      vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
        return { animationName: "slide" } as CSSStyleDeclaration;
      });
      const replace = mockLiveAnimations(el, initial);
      const adapter = createCssAdapter();
      adapter.discover();
      return { adapter, replace };
    };

    afterEach(() => {
      el.remove();
      el.style.removeProperty("animation-delay");
      el.style.removeProperty("animation-play-state");
      vi.restoreAllMocks();
    });

    it("seek drives the live animation, not the one seen at discover", () => {
      const stale = makeAnimation(el);
      const current = makeAnimation(el);
      const { adapter, replace } = setup([stale]);

      replace([current]);
      adapter.seek({ time: 3 });

      expect(current.currentTime).toBe(2000);
      expect(current.pause).toHaveBeenCalled();
      expect(stale.currentTime).toBe(0);
    });

    it("seeks from the pass's shared page list without a scan of its own", () => {
      const current = makeAnimation(el);
      const { adapter } = setup([]);
      const getAnimations = vi.spyOn(document, "getAnimations");

      adapter.seek({ time: 3, pageAnimations: () => [current] });

      expect(getAnimations).not.toHaveBeenCalled();
      expect(current.currentTime).toBe(2000);
    });

    it("pause takes the seek pass's page list when given one and scans without it", () => {
      const current = makeAnimation(el);
      const { adapter } = setup([current]);
      const getAnimations = vi.spyOn(document, "getAnimations");

      adapter.pause({ pageAnimations: () => [current] });
      expect(getAnimations).not.toHaveBeenCalled();
      expect(current.pause).toHaveBeenCalledTimes(1);

      adapter.pause();
      expect(getAnimations).toHaveBeenCalledTimes(1);
      expect(current.pause).toHaveBeenCalledTimes(2);
    });

    it("seeks back into a finished no-fill animation after it left the page's list", () => {
      const finished = makeAnimation(el);
      const { adapter, replace } = setup([finished]);

      adapter.seek({ time: 1.5 });
      replace([]);
      adapter.seek({ time: 1.25 });

      expect(finished.currentTime).toBe(250);
      expect(el.style.animationDelay).toBe("");
    });

    it("never writes to an animation the browser cancelled, and falls back to the inline pose", () => {
      const cancelled = makeAnimation(el);
      const { adapter, replace } = setup([cancelled]);

      adapter.seek({ time: 1.5 });
      replace([]);
      Object.assign(cancelled, { playState: "idle", currentTime: null });
      adapter.seek({ time: 2 });

      expect(cancelled.currentTime).toBeNull();
      expect(el.style.animationDelay).toBe("-1s");
    });

    it("forgets a cancelled animation instead of checking it on every seek", () => {
      const { adapter, replace } = setup([]);
      const playStateReads: Array<() => string> = [];
      for (let showing = 0; showing < 3; showing++) {
        const shown = makeAnimation(el);
        const readPlayState = vi.fn(() => "idle");
        Object.defineProperty(shown, "playState", { get: readPlayState });
        playStateReads.push(readPlayState);
        replace([shown]);
        adapter.seek({ time: 1.5 });
        replace([]);
        adapter.seek({ time: 2 });
        adapter.seek({ time: 2.5 });
      }

      for (const readPlayState of playStateReads) expect(readPlayState).toHaveBeenCalledTimes(1);
    });

    it("forgets every known animation on revert", () => {
      const finished = makeAnimation(el);
      const { adapter, replace } = setup([finished]);

      adapter.seek({ time: 1.5 });
      adapter.revert?.();
      adapter.discover();
      replace([]);
      adapter.seek({ time: 1.25 });

      expect(finished.currentTime).toBe(500);
    });

    it("rediscover keeps a remembered handle for an element still in the page", () => {
      const finished = makeAnimation(el);
      const { adapter, replace } = setup([finished]);

      adapter.seek({ time: 1.5 });
      replace([]);
      adapter.discover();
      adapter.seek({ time: 1.25 });

      expect(finished.currentTime).toBe(250);
      expect(el.style.animationDelay).toBe("");
    });

    it("rediscover forgets the handles of an element no longer in the page", () => {
      const finished = makeAnimation(el);
      const { adapter, replace } = setup([finished]);

      adapter.seek({ time: 1.5 });
      replace([]);
      el.remove();
      adapter.discover();
      document.body.appendChild(el);
      adapter.discover();
      adapter.seek({ time: 1.25 });

      expect(finished.currentTime).toBe(500);
      expect(el.style.animationDelay).toBe("-0.25s");
    });

    it("leaves the element's pseudo-element animations alone, as el.getAnimations() does", () => {
      const own = makeAnimation(el);
      const before = Object.assign(makeAnimation(el), {
        effect: { target: el, pseudoElement: "::before" },
      });
      const { adapter } = setup([own, before]);

      adapter.seek({ time: 3 });

      expect(own.currentTime).toBe(2000);
      expect(before.currentTime).toBe(0);
    });

    it("leaves CSS transitions and script animations on the element to the WAAPI adapter", () => {
      const own = makeAnimation(el);
      const others = [makeAnimation(el, FakeCSSTransition), makeAnimation(el, FakeAnimation)];
      const { adapter } = setup([own, ...others]);

      adapter.seek({ time: 3 });
      adapter.play?.();
      adapter.pause();

      expect(own.currentTime).toBe(2000);
      for (const other of others) {
        expect(other.currentTime).toBe(0);
        expect(other.pause).not.toHaveBeenCalled();
        expect(other.play).not.toHaveBeenCalled();
      }
    });

    it("seeks every animation where the browser has no CSSAnimation to tell them apart", () => {
      vi.stubGlobal("CSSAnimation", undefined);
      const animation = makeAnimation(el, FakeAnimation);
      const { adapter } = setup([animation]);

      adapter.seek({ time: 3 });

      expect(animation.currentTime).toBe(2000);
    });

    it("play and pause act on the live animation", () => {
      const stale = makeAnimation(el);
      const current = makeAnimation(el);
      const { adapter, replace } = setup([stale]);

      replace([current]);
      adapter.play?.();
      adapter.pause();

      expect(current.play).toHaveBeenCalled();
      expect(current.pause).toHaveBeenCalled();
      expect(stale.play).not.toHaveBeenCalled();
      expect(stale.pause).not.toHaveBeenCalled();
    });

    it("drops the fallback's inline delay once a live animation exists", () => {
      const current = makeAnimation(el);
      const { adapter, replace } = setup([]);

      adapter.seek({ time: 3 });
      expect(el.style.animationDelay).toBe("-2s");

      replace([current]);
      adapter.seek({ time: 4 });

      expect(el.style.animationDelay).toBe("");
      expect(el.style.animationPlayState).toBe("");
      expect(current.currentTime).toBe(3000);
    });

    it("rediscover does not read a fallback seek's inline delay back as authored", () => {
      const { adapter } = setup([]);

      adapter.seek({ time: 3 });
      adapter.discover();
      adapter.pause();

      expect(el.style.animationDelay).toBe("");
      expect(el.style.animationPlayState).toBe("");
    });
  });

  it("play resumes WAAPI animations and restores inline styles", () => {
    const el = document.createElement("div");
    el.style.animationName = "spin";
    el.style.animationPlayState = "running";
    document.body.appendChild(el);

    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { animationName: "spin" } as CSSStyleDeclaration;
    });

    const animation = makeAnimation(el);
    mockLiveAnimations(el, [animation]);

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

  describe("cycle end", () => {
    const mountAnimated = (style: Partial<CSSStyleDeclaration>) => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "2");
      document.body.appendChild(el);
      vi.spyOn(window, "getComputedStyle").mockImplementation(
        () =>
          ({ animationDelay: el.style.animationDelay || "0s", ...style }) as CSSStyleDeclaration,
      );
      return el;
    };

    afterEach(() => {
      document.body.replaceChildren();
      vi.restoreAllMocks();
    });

    it("reads one cycle per animation from the computed lists, not the live animations", () => {
      // A display:none clip or a finished animation has no live handle; its CSS still counts.
      const el = mountAnimated({
        animationName: "a, none, b, c",
        animationDuration: "1s, 9s, 1500ms",
        animationDelay: "0s, 0s, 0s, 2s",
      });
      el.getAnimations = () => [];

      const adapter = createCssAdapter();
      adapter.discover();

      // c pairs the 2s delay with the first duration again: 2 + 2 + 1.
      expect(adapter.getAnimationCycleEndSeconds?.()).toBe(5);
      expect(adapter.getInferredDurationSeconds?.()).toBeNull();
    });

    it("skips an animation whose negative delay ends it before it starts", () => {
      mountAnimated({ animationName: "a", animationDuration: "1s", animationDelay: "-2s" });

      const adapter = createCssAdapter();
      adapter.discover();

      expect(adapter.getAnimationCycleEndSeconds?.()).toBeNull();
    });

    it("keeps the authored delay when rediscovered after a fallback seek", () => {
      const el = mountAnimated({ animationName: "pulse", animationDuration: "1s" });
      el.getAnimations = () => [];

      const adapter = createCssAdapter();
      adapter.discover();
      adapter.seek({ time: 5 });
      expect(el.style.animationDelay).toBe("-3s");
      adapter.discover();
      adapter.pause();

      expect(adapter.getAnimationCycleEndSeconds?.()).toBe(3);
      expect(el.style.animationDelay).toBe("");
    });

    it("skips an element removed after discover", () => {
      const el = mountAnimated({});
      vi.mocked(window.getComputedStyle).mockImplementation(
        (node) =>
          ({
            animationName: node === el ? "a" : "none",
            animationDuration: "1s",
            animationDelay: "0s",
          }) as CSSStyleDeclaration,
      );

      const adapter = createCssAdapter();
      adapter.discover();
      expect(adapter.getAnimationCycleEndSeconds?.()).toBe(3);
      el.remove();

      expect(adapter.getAnimationCycleEndSeconds?.()).toBeNull();
    });
  });

  describe("a child without its own data-start", () => {
    const mount = (clipStart: string | null) => {
      const box = document.createElement("div");
      if (clipStart === null) {
        document.body.appendChild(box);
      } else {
        const clip = document.createElement("div");
        clip.setAttribute("data-start", clipStart);
        clip.appendChild(box);
        document.body.appendChild(clip);
      }
      vi.spyOn(window, "getComputedStyle").mockImplementation(
        (node) => ({ animationName: node === box ? "slide" : "none" }) as CSSStyleDeclaration,
      );
      const animation = makeAnimation(box);
      mockLiveAnimations(box, [animation]);
      return animation;
    };

    afterEach(() => {
      document.body.replaceChildren();
      vi.restoreAllMocks();
    });

    it.each([
      ["the runtime's resolver", { resolveStartSeconds: ownStart }],
      ["no resolver", undefined],
    ])("is timed from its clip's start with %s", (_, params) => {
      const animation = mount("6");
      const adapter = createCssAdapter(params);
      adapter.discover();

      adapter.seek({ time: 8 });

      expect(animation.currentTime).toBe(2000);
    });

    it.each([
      ["inside a clip at 0", "0"],
      ["outside any clip", null],
    ])("keeps start 0 %s", (_, clipStart) => {
      const animation = mount(clipStart);
      const adapter = createCssAdapter({ resolveStartSeconds: ownStart });
      adapter.discover();

      adapter.seek({ time: 3 });

      expect(animation.currentTime).toBe(3000);
    });
  });

  describe("a hidden late clip's fallback pose", () => {
    // <div class="clip" data-start="6" style="display:none"><div id="box" style="animation: ..."></div></div>
    const mountHiddenClip = (style: Partial<CSSStyleDeclaration>, inlineDelay = "") => {
      const clip = document.createElement("div");
      clip.setAttribute("data-start", "6");
      clip.style.display = "none";
      const box = document.createElement("div");
      box.style.animationDelay = inlineDelay;
      clip.appendChild(box);
      document.body.appendChild(clip);
      box.getAnimations = () => [];
      vi.spyOn(window, "getComputedStyle").mockImplementation(
        (node) =>
          (node === box
            ? {
                animationDuration: "4s",
                animationDelay: box.style.animationDelay || "0s",
                ...style,
              }
            : { animationName: "none" }) as CSSStyleDeclaration,
      );
      const adapter = createCssAdapter({ resolveStartSeconds: ownStart });
      adapter.discover();
      return { adapter, box };
    };

    afterEach(() => {
      document.body.replaceChildren();
      vi.restoreAllMocks();
    });

    it("waits out the authored delay before it moves, and runs from it after", () => {
      const { adapter, box } = mountHiddenClip({ animationName: "slide", animationDelay: "1s" });

      // 0.5 s into the clip, 0.5 s of the 1 s delay remain: the first visible frame is unstarted.
      adapter.seek({ time: 6.5 });
      adapter.pause();
      expect(box.style.animationDelay).toBe("0.5s");
      expect(box.style.animationPlayState).toBe("paused");

      // 2 s into the clip is 1 s into the animation, a quarter of its 4 s.
      adapter.seek({ time: 8 });
      adapter.pause();
      expect(box.style.animationDelay).toBe("-1s");
    });

    it("shifts each animation by its own delay, repeating a shorter delay list", () => {
      const { adapter, box } = mountHiddenClip({
        animationName: "slide, fade, spin",
        animationDelay: "1s, 250ms",
      });

      adapter.seek({ time: 6.5 });

      expect(box.style.animationDelay).toBe("0.5s, -0.25s, 0.5s");
    });

    it("honours a delay written in the element's style attribute, also after a rediscover", () => {
      const { adapter, box } = mountHiddenClip({ animationName: "slide" }, "1s");

      adapter.seek({ time: 6.5 });
      expect(box.style.animationDelay).toBe("0.5s");

      adapter.discover();
      adapter.seek({ time: 8 });
      expect(box.style.animationDelay).toBe("-1s");

      adapter.play?.();
      expect(box.style.animationDelay).toBe("1s");
    });
  });
});

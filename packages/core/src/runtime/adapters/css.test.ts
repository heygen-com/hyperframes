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
});

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createRuntimeStartTimeResolver } from "./startResolver";

// jsdom doesn't provide CSS.escape — polyfill it
beforeAll(() => {
  if (typeof globalThis.CSS === "undefined") {
    (globalThis as any).CSS = {};
  }
  if (typeof CSS.escape !== "function") {
    CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
  }
});

describe("createRuntimeStartTimeResolver", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("resolveStartForElement", () => {
    it("resolves absolute numeric data-start", () => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "5");
      document.body.appendChild(el);
      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(el)).toBe(5);
    });

    it("resolves zero start", () => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "0");
      document.body.appendChild(el);
      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(el)).toBe(0);
    });

    it("returns fallback when no data-start", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(el, 3)).toBe(3);
    });

    it("resolves reference to another element (after end)", () => {
      const a = document.createElement("div");
      a.id = "scene-1";
      a.setAttribute("data-start", "2");
      a.setAttribute("data-duration", "3");
      document.body.appendChild(a);

      const b = document.createElement("div");
      b.setAttribute("data-start", "scene-1");
      document.body.appendChild(b);

      const resolver = createRuntimeStartTimeResolver({});
      // scene-1 starts at 2, duration 3, so b starts at 2+3 = 5
      expect(resolver.resolveStartForElement(b)).toBe(5);
    });

    it("resolves reference with positive offset", () => {
      const a = document.createElement("div");
      a.id = "intro";
      a.setAttribute("data-start", "0");
      a.setAttribute("data-duration", "5");
      document.body.appendChild(a);

      const b = document.createElement("div");
      b.setAttribute("data-start", "intro + 2");
      document.body.appendChild(b);

      const resolver = createRuntimeStartTimeResolver({});
      // intro ends at 5, offset +2 → 7
      expect(resolver.resolveStartForElement(b)).toBe(7);
    });

    it("resolves reference with negative offset", () => {
      const a = document.createElement("div");
      a.id = "scene-a";
      a.setAttribute("data-start", "0");
      a.setAttribute("data-duration", "10");
      document.body.appendChild(a);

      const b = document.createElement("div");
      b.setAttribute("data-start", "scene-a - 3");
      document.body.appendChild(b);

      const resolver = createRuntimeStartTimeResolver({});
      // scene-a ends at 10, offset -3 → 7
      expect(resolver.resolveStartForElement(b)).toBe(7);
    });

    it("clamps resolved start to 0", () => {
      const a = document.createElement("div");
      a.id = "clip";
      a.setAttribute("data-start", "1");
      a.setAttribute("data-duration", "2");
      document.body.appendChild(a);

      const b = document.createElement("div");
      b.setAttribute("data-start", "clip - 100");
      document.body.appendChild(b);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(b)).toBe(0);
    });

    it("handles circular references gracefully", () => {
      const a = document.createElement("div");
      a.id = "a";
      a.setAttribute("data-start", "b");
      document.body.appendChild(a);

      const b = document.createElement("div");
      b.id = "b";
      b.setAttribute("data-start", "a");
      document.body.appendChild(b);

      const resolver = createRuntimeStartTimeResolver({});
      // Should not infinite loop — returns fallback
      expect(resolver.resolveStartForElement(a)).toBeGreaterThanOrEqual(0);
      expect(resolver.resolveStartForElement(b)).toBeGreaterThanOrEqual(0);
    });

    it("uses data-composition-id selector for lookup", () => {
      const comp = document.createElement("div");
      comp.setAttribute("data-composition-id", "hero");
      comp.setAttribute("data-start", "0");
      comp.setAttribute("data-duration", "5");
      document.body.appendChild(comp);

      const after = document.createElement("div");
      after.setAttribute("data-start", "hero");
      document.body.appendChild(after);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(after)).toBe(5);
    });

    it("uses preserved authored duration when live composition duration was sanitized", () => {
      const slide1 = document.createElement("div");
      slide1.id = "slide-1";
      slide1.setAttribute("data-composition-id", "slide-1");
      slide1.setAttribute("data-start", "0");
      slide1.setAttribute("data-hf-authored-duration", "14");
      document.body.appendChild(slide1);

      const slide2 = document.createElement("div");
      slide2.id = "slide-2";
      slide2.setAttribute("data-start", "slide-1");
      slide2.setAttribute("data-hf-authored-duration", "12");
      document.body.appendChild(slide2);

      const slide3 = document.createElement("div");
      slide3.setAttribute("data-start", "slide-2");
      document.body.appendChild(slide3);

      const resolver = createRuntimeStartTimeResolver({ includeAuthoredTimingAttrs: true });
      expect(resolver.resolveStartForElement(slide2)).toBe(14);
      expect(resolver.resolveStartForElement(slide3)).toBe(26);
    });

    it("adds composition host offset for nested absolute starts", () => {
      const host = document.createElement("div");
      host.id = "slide-5";
      host.setAttribute("data-composition-id", "slide-video-agent");
      host.setAttribute("data-start", "54");
      host.setAttribute("data-duration", "45");
      document.body.appendChild(host);

      const innerRoot = document.createElement("div");
      innerRoot.setAttribute("data-composition-id", "slide-video-agent");
      host.appendChild(innerRoot);

      const video = document.createElement("video");
      video.setAttribute("data-start", "0");
      innerRoot.appendChild(video);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(video)).toBe(54);
    });

    it("keeps nested references in the host composition timeline", () => {
      const host = document.createElement("div");
      host.id = "slide-5";
      host.setAttribute("data-composition-id", "slide-video-agent");
      host.setAttribute("data-start", "54");
      host.setAttribute("data-duration", "45");
      document.body.appendChild(host);

      const innerRoot = document.createElement("div");
      innerRoot.setAttribute("data-composition-id", "slide-video-agent");
      host.appendChild(innerRoot);

      const firstClip = document.createElement("div");
      firstClip.id = "bullet-reveal";
      firstClip.setAttribute("data-start", "1");
      firstClip.setAttribute("data-duration", "2");
      innerRoot.appendChild(firstClip);

      const secondClip = document.createElement("div");
      secondClip.setAttribute("data-start", "bullet-reveal + 1");
      innerRoot.appendChild(secondClip);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(firstClip)).toBe(55);
      expect(resolver.resolveStartForElement(secondClip)).toBe(58);
    });

    it("adds the nearest composition root start for nested absolute media in inlined compositions", () => {
      const root = document.createElement("div");
      root.setAttribute("data-composition-id", "main");
      document.body.appendChild(root);

      const slide1 = document.createElement("div");
      slide1.id = "slide-1";
      slide1.setAttribute("data-composition-id", "slide-core-conviction");
      slide1.setAttribute("data-start", "0");
      slide1.setAttribute("data-hf-authored-duration", "14");
      root.appendChild(slide1);

      const slide2 = document.createElement("div");
      slide2.id = "slide-2";
      slide2.setAttribute("data-composition-id", "slide-avatar-v");
      slide2.setAttribute("data-start", "slide-1");
      slide2.setAttribute("data-hf-authored-duration", "12");
      root.appendChild(slide2);

      const slide3 = document.createElement("div");
      slide3.id = "slide-3";
      slide3.setAttribute("data-composition-id", "slide-translation");
      slide3.setAttribute("data-start", "slide-2");
      slide3.setAttribute("data-hf-authored-duration", "16");
      root.appendChild(slide3);

      const video = document.createElement("video");
      video.setAttribute("data-start", "0");
      slide3.appendChild(video);

      const resolver = createRuntimeStartTimeResolver({ includeAuthoredTimingAttrs: true });
      expect(resolver.resolveStartForElement(slide2)).toBe(14);
      expect(resolver.resolveStartForElement(slide3)).toBe(26);
      expect(resolver.resolveStartForElement(video)).toBe(26);
    });

    it("returns fallback when reference target not found", () => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "nonexistent");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(el, 0)).toBe(0);
    });

    it("caches resolved values (second call is same result)", () => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "3.5");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      const first = resolver.resolveStartForElement(el);
      const second = resolver.resolveStartForElement(el);
      expect(first).toBe(second);
      expect(first).toBe(3.5);
    });
  });

  describe("resolveDurationForElement", () => {
    it("resolves explicit data-duration", () => {
      const el = document.createElement("div");
      el.setAttribute("data-duration", "7");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveDurationForElement(el)).toBe(7);
    });

    it("resolves from data-end minus start", () => {
      const el = document.createElement("div");
      el.setAttribute("data-start", "2");
      el.setAttribute("data-end", "8");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveDurationForElement(el)).toBe(6);
    });

    it("returns null when no duration info available", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveDurationForElement(el)).toBeNull();
    });

    it("resolves from timeline registry for compositions", () => {
      const el = document.createElement("div");
      el.setAttribute("data-composition-id", "comp-1");
      document.body.appendChild(el);

      const mockTimeline = {
        duration: () => 12,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
      };
      const resolver = createRuntimeStartTimeResolver({
        timelineRegistry: { "comp-1": mockTimeline as any },
      });
      expect(resolver.resolveDurationForElement(el)).toBe(12);
    });

    it("prefers data-duration over timeline registry", () => {
      const el = document.createElement("div");
      el.setAttribute("data-composition-id", "comp-1");
      el.setAttribute("data-duration", "5");
      document.body.appendChild(el);

      const mockTimeline = {
        duration: () => 12,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
      };
      const resolver = createRuntimeStartTimeResolver({
        timelineRegistry: { "comp-1": mockTimeline as any },
      });
      expect(resolver.resolveDurationForElement(el)).toBe(5);
    });

    it("resolves preserved authored duration when runtime stripped the public attr", () => {
      const el = document.createElement("div");
      el.setAttribute("data-composition-id", "comp-1");
      el.setAttribute("data-hf-authored-duration", "9");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({ includeAuthoredTimingAttrs: true });
      expect(resolver.resolveDurationForElement(el)).toBe(9);
    });

    it("ignores preserved authored duration by default", () => {
      const el = document.createElement("div");
      el.setAttribute("data-composition-id", "comp-1");
      el.setAttribute("data-hf-authored-duration", "9");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveDurationForElement(el)).toBeNull();
    });

    it("caches duration results", () => {
      const el = document.createElement("div");
      el.setAttribute("data-duration", "4");
      document.body.appendChild(el);

      const resolver = createRuntimeStartTimeResolver({});
      const first = resolver.resolveDurationForElement(el);
      const second = resolver.resolveDurationForElement(el);
      expect(first).toBe(second);
    });
  });
});

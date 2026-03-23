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

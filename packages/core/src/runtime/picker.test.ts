import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createPickerModule } from "./picker";

// jsdom does not implement CSS.escape — polyfill a compact spec-adjacent
// version. Parallel (simpler) polyfills already live in compositionLoader.test.ts
// / startResolver.test.ts, but they don't handle the leading-digit case this
// test needs. Each test file runs in an isolated environment, so we duplicate
// rather than import.
beforeAll(() => {
  const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
  if (!css || typeof css.escape !== "function") {
    (globalThis as { CSS?: { escape: (input: string) => string } }).CSS = {
      ...(css ?? {}),
      escape: (value: string) => {
        // Non-word chars get a leading backslash (spec-adjacent).
        const escaped = value.replace(/([^\w-])/g, "\\$1");
        // A leading digit must be encoded as `\<hex> ` (space terminator) per CSS spec.
        const first = value.charCodeAt(0);
        if (first >= 48 && first <= 57) {
          return `\\${first.toString(16)} ${escaped.slice(1)}`;
        }
        return escaped;
      },
    };
  }
});

function createMockPostMessage() {
  return vi.fn();
}

describe("createPickerModule", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("style").forEach((s) => s.remove());
    document.body.classList.remove("__hf-pick-active");
  });

  it("returns enablePickMode, disablePickMode, installPickerApi", () => {
    const picker = createPickerModule({ postMessage: createMockPostMessage() });
    expect(typeof picker.enablePickMode).toBe("function");
    expect(typeof picker.disablePickMode).toBe("function");
    expect(typeof picker.installPickerApi).toBe("function");
  });

  describe("enablePickMode / disablePickMode", () => {
    it("adds and removes pick-active class on body", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.enablePickMode();
      expect(document.body.classList.contains("__hf-pick-active")).toBe(true);

      picker.disablePickMode();
      expect(document.body.classList.contains("__hf-pick-active")).toBe(false);
    });

    it("injects and removes style element", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.enablePickMode();
      const styles = document.head.querySelectorAll("style");
      const hasPickStyle = Array.from(styles).some((s) =>
        s.textContent?.includes("__hf-pick-highlight"),
      );
      expect(hasPickStyle).toBe(true);

      picker.disablePickMode();
      const stylesAfter = document.head.querySelectorAll("style");
      const hasPickStyleAfter = Array.from(stylesAfter).some((s) =>
        s.textContent?.includes("__hf-pick-highlight"),
      );
      expect(hasPickStyleAfter).toBe(false);
    });

    it("enabling twice is idempotent", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.enablePickMode();
      picker.enablePickMode();
      expect(document.body.classList.contains("__hf-pick-active")).toBe(true);
    });

    it("disabling when not active is safe", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      expect(() => picker.disablePickMode()).not.toThrow();
    });
  });

  describe("installPickerApi", () => {
    it("installs __HF_PICKER_API on window", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;
      expect(api).toBeDefined();
      expect(typeof api.enable).toBe("function");
      expect(typeof api.disable).toBe("function");
      expect(typeof api.isActive).toBe("function");
      expect(typeof api.getHovered).toBe("function");
      expect(typeof api.getSelected).toBe("function");
      expect(typeof api.getCandidatesAtPoint).toBe("function");
      expect(typeof api.pickAtPoint).toBe("function");
      expect(typeof api.pickManyAtPoint).toBe("function");
    });

    it("isActive returns pick mode state", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;

      expect(api.isActive()).toBe(false);
      picker.enablePickMode();
      expect(api.isActive()).toBe(true);
      picker.disablePickMode();
      expect(api.isActive()).toBe(false);
    });

    it("getCandidatesAtPoint returns empty for invalid coords", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;
      expect(api.getCandidatesAtPoint(NaN, NaN)).toEqual([]);
      expect(api.getCandidatesAtPoint(Infinity, 0)).toEqual([]);
    });

    it("does not pick through blocking loading overlays", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const scene = document.createElement("div");
      scene.id = "scene-title";
      scene.textContent = "Scene title";
      const overlay = document.createElement("div");
      overlay.setAttribute("data-hyper-shader-loading", "");
      const overlayLabel = document.createElement("span");
      overlayLabel.textContent = "Preparing scene transitions";
      overlay.appendChild(overlayLabel);
      document.body.appendChild(scene);
      document.body.appendChild(overlay);

      const originalElementsFromPoint = document.elementsFromPoint;
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: vi.fn(() => [overlayLabel, overlay, scene]),
      });

      const api = (window as any).__HF_PICKER_API;
      try {
        expect(api.getCandidatesAtPoint(10, 10)).toEqual([]);
      } finally {
        Object.defineProperty(document, "elementsFromPoint", {
          configurable: true,
          value: originalElementsFromPoint,
        });
      }
    });

    it("pickAtPoint returns null for invalid coords", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;
      expect(api.pickAtPoint(NaN, NaN)).toBeNull();
    });

    it("pickManyAtPoint returns empty for invalid coords", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;
      expect(api.pickManyAtPoint(NaN, NaN)).toEqual([]);
    });

    it("getHovered returns null initially", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;
      expect(api.getHovered()).toBeNull();
    });

    it("getSelected returns null initially", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const api = (window as any).__HF_PICKER_API;
      expect(api.getSelected()).toBeNull();
    });
  });

  describe("escape key handler", () => {
    it("disables pick mode and posts cancel message on Escape", () => {
      const postMessage = createMockPostMessage();
      const picker = createPickerModule({ postMessage });
      picker.enablePickMode();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(document.body.classList.contains("__hf-pick-active")).toBe(false);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "hf-preview",
          type: "pick-mode-cancelled",
        }),
      );
    });

    it("ignores non-Escape keys", () => {
      const postMessage = createMockPostMessage();
      const picker = createPickerModule({ postMessage });
      picker.enablePickMode();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(document.body.classList.contains("__hf-pick-active")).toBe(true);
    });
  });

  describe("buildElementSelector escapes digit-leading ids", () => {
    it('produces a CSS-valid selector for id="0" and picks the element back', () => {
      // Regression: a user's HTML with id="0" (or any digit-leading id) used
      // to produce the raw selector "#0", which is invalid per the CSS spec —
      // downstream querySelector calls threw SyntaxError. buildElementSelector
      // now CSS.escapes the id.
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      const el = document.createElement("div");
      el.id = "0";
      Object.assign(el.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        width: "40px",
        height: "40px",
      });
      document.body.appendChild(el);

      // Force elementsFromPoint to hit our div so we exercise the real code
      // path that calls buildElementSelector via extractElementInfo.
      const originalElementsFromPoint = document.elementsFromPoint;
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: () => [el],
      });
      try {
        const api = (
          window as {
            __HF_PICKER_API?: {
              pickAtPoint?: (x: number, y: number) => { selector: string } | null;
            };
          }
        ).__HF_PICKER_API;
        const picked = api?.pickAtPoint?.(10, 10);
        expect(picked?.selector).toBe("#\\30 ");
        // And the round trip must find the element back through querySelector.
        expect(() => document.querySelector(picked?.selector ?? "")).not.toThrow();
        expect(document.querySelector(picked?.selector ?? "")).toBe(el);
      } finally {
        Object.defineProperty(document, "elementsFromPoint", {
          configurable: true,
          value: originalElementsFromPoint,
        });
      }
    });
  });
});

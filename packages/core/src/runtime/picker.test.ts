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

function ancestorsOf(el: Element): Element[] {
  const chain: Element[] = [];
  for (let at = el.parentElement; at; at = at.parentElement) chain.push(at);
  return chain;
}

// Like a browser: the paint stack under the point, top first, minus computed pointer-events:none.
function emulateHitTest(painted: () => Element[]): () => void {
  const original = document.elementsFromPoint;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => painted().filter((el) => getComputedStyle(el).pointerEvents !== "none")),
  });
  return () =>
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: original });
}

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
      picker.disablePickMode();
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

    it("picks inside a mounted section whose root sets pointer-events:none", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      // The mount rescopes the section's own root rule onto its inner root.
      document.head.innerHTML =
        '<style>[data-composition-id="intro"] > [data-hf-inner-root] { pointer-events: none }' +
        " .vignette { pointer-events: none }</style>";
      document.body.innerHTML = `<div data-composition-id="intro" data-composition-src="intro.html">
        <div data-hf-inner-root="true"><div class="card"><code id="code">tl.to()</code></div>
        <div class="vignette" id="vignette"></div></div></div>`;
      const code = document.getElementById("code")!;
      // Paint order under the point, top first; like a browser, drop what has pointer-events:none.
      const painted = [document.getElementById("vignette")!, code, code.parentElement!];
      const originalElementsFromPoint = document.elementsFromPoint;
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: vi.fn(() =>
          [...painted, ...ancestorsOf(code.parentElement!)].filter(
            (el) => getComputedStyle(el).pointerEvents !== "none",
          ),
        ),
      });

      const api = (window as any).__HF_PICKER_API;
      try {
        expect(api.getCandidatesAtPoint(10, 10)[0]?.selector).toBe("#code");
        expect(api.pickAtPoint(10, 10)?.selector).toBe("#code");
        expect(document.head.querySelectorAll("style")).toHaveLength(1);
      } finally {
        Object.defineProperty(document, "elementsFromPoint", {
          configurable: true,
          value: originalElementsFromPoint,
        });
      }
    });

    it("picks inside a composition opened on its own whose root sets pointer-events:none", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      document.head.innerHTML = "<style>#root { pointer-events: none }</style>";
      document.body.innerHTML = `<div id="root" data-composition-id="intro"><div id="card">
        <code id="code">tl.to()</code></div></div>`;
      const at = (id: string) => document.getElementById(id)!;
      const restore = emulateHitTest(() => [at("code"), at("card"), at("root")]);
      const api = (window as any).__HF_PICKER_API;
      try {
        expect(api.getCandidatesAtPoint(10, 10).map((c: any) => c.selector)).toEqual([
          "#code",
          "#card",
        ]);
      } finally {
        restore();
      }
    });

    it("adopts the override only for the hit test, leaving the DOM and a saved outerHTML untouched", () => {
      const adopted: CSSStyleSheet[] = [];
      Object.defineProperty(document, "adoptedStyleSheets", {
        configurable: true,
        get: () => adopted.slice(),
        set: (next: CSSStyleSheet[]) => adopted.splice(0, adopted.length, ...next),
      });
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      document.body.innerHTML =
        '<div data-composition-id="intro"><div data-hf-inner-root="true" style="pointer-events: none">' +
        '<span id="t">hi</span></div></div>';
      const during: string[][] = [];
      const originalElementsFromPoint = document.elementsFromPoint;
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: vi.fn(() => {
          during.push(adopted.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)));
          return [document.getElementById("t")!];
        }),
      });
      const observer = new MutationObserver(() => {});
      observer.observe(document, { childList: true, subtree: true, attributes: true });
      const html = document.documentElement.outerHTML;

      const api = (window as any).__HF_PICKER_API;
      try {
        // jsdom ignores adopted sheets for style, so this checks the sheet's lifecycle, not what it picks.
        api.getCandidatesAtPoint(10, 10);
        api.pickAtPoint(10, 10);
        expect(during).toHaveLength(2);
        expect(during[0]?.join()).toContain("pointer-events: auto !important");
        expect(adopted).toEqual([]);
        expect(observer.takeRecords()).toEqual([]);
        expect(document.documentElement.outerHTML).toBe(html);
        // With no pass-through root there is nothing to override, so nothing is adopted and nothing restyles.
        (document.querySelector("[data-hf-inner-root]") as HTMLElement).style.pointerEvents = "";
        api.getCandidatesAtPoint(10, 10);
        expect(during.at(-1)).toEqual([]);
      } finally {
        observer.disconnect();
        Object.defineProperty(document, "elementsFromPoint", {
          configurable: true,
          value: originalElementsFromPoint,
        });
        delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
      }
    });

    it("keeps a click-through overlay host passing through to what is under it", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      document.body.innerHTML = `<div id="root" data-composition-id="main"><video id="aroll"></video>
        <div id="ovl" data-composition-id="intro_outro" data-composition-src="intro.html"
          style="pointer-events: none"><div data-hf-inner-root="true"><h1 id="t">Hi</h1></div></div></div>`;
      const at = (id: string) => document.getElementById(id)!;
      const inner = document.querySelector("[data-hf-inner-root]")!;
      const restore = emulateHitTest(() => [at("t"), inner, at("ovl"), at("aroll"), at("root")]);
      const api = (window as any).__HF_PICKER_API;
      try {
        expect(api.getCandidatesAtPoint(10, 10).map((c: any) => c.selector)).toEqual([
          "#aroll",
          "#root",
        ]);
      } finally {
        restore();
      }
    });

    it("a section background click picks the host, and an inner root never gets a bare tag selector", () => {
      const picker = createPickerModule({ postMessage: createMockPostMessage() });
      picker.installPickerApi();
      document.head.innerHTML =
        '<style>[data-composition-id="intro"] > [data-hf-inner-root] { pointer-events: none }</style>';
      document.body.innerHTML = `<div id="root" data-composition-id="main"><div id="host"
        data-composition-id="intro" data-composition-src="intro.html"><div data-hf-inner-root="true">
        </div></div><div data-composition-id="outro"><div data-hf-inner-root="true"></div></div></div>`;
      const [intro, outro] = Array.from(document.querySelectorAll("[data-hf-inner-root]"));
      const api = (window as any).__HF_PICKER_API;
      let restore = emulateHitTest(() => [
        intro!,
        intro!.parentElement!,
        document.getElementById("root")!,
      ]);
      try {
        expect(api.getCandidatesAtPoint(10, 10).map((c: any) => c.selector)).toEqual([
          "#host",
          "#root",
        ]);
      } finally {
        restore();
      }
      restore = emulateHitTest(() => [outro!, outro!.parentElement!]);
      try {
        expect(api.getCandidatesAtPoint(10, 10)[0]?.selector).toBe(
          '[data-composition-id="outro"] > [data-hf-inner-root]',
        );
      } finally {
        restore();
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

  describe("pick mode under a resting pointer", () => {
    const at = (id: string) => document.getElementById(id)!;
    const move = () =>
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true }),
      );

    it("keeps the highlight on what the pointer is over, and offers it on click", () => {
      const postMessage = createMockPostMessage();
      const picker = createPickerModule({ postMessage });
      picker.installPickerApi();
      document.body.innerHTML = `<div id="bg" style="background: rgb(245, 238, 220)"><h1 id="title">Hi</h1></div>`;
      const restore = emulateHitTest(() => [at("title"), at("bg")]);
      try {
        picker.enablePickMode();
        move();
        move();
        expect(at("title").classList.contains("__hf-pick-highlight")).toBe(true);
        expect(at("bg").classList.contains("__hf-pick-highlight")).toBe(false);
        document.dispatchEvent(
          new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }),
        );
        const picked = postMessage.mock.calls
          .map(([message]) => message)
          .find((message) => message.type === "element-pick-candidates");
        expect(picked.candidates.map((c: any) => c.selector)).toEqual(["#title", "#bg"]);
      } finally {
        picker.disablePickMode();
        restore();
      }
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
      picker.disablePickMode();
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

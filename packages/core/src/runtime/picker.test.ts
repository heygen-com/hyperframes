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

// The selectors getCandidatesAtPoint(10, 10) returns while the hit test yields `stack`.
function candidatesUnder(stack: () => Element[]): string[] {
  const restore = emulateHitTest(stack);
  try {
    return (window as any).__HF_PICKER_API.getCandidatesAtPoint(10, 10).map((c: any) => c.selector);
  } finally {
    restore();
  }
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
      expect(candidatesUnder(() => [at("code"), at("card"), at("root")])).toEqual([
        "#code",
        "#card",
      ]);
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
      expect(candidatesUnder(() => [at("t"), inner, at("ovl"), at("aroll"), at("root")])).toEqual([
        "#aroll",
        "#root",
      ]);
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

  describe("picks what is drawn under the pointer", () => {
    const selectorsAt = (x = 10, y = 10) =>
      (window as any).__HF_PICKER_API.getCandidatesAtPoint(x, y).map((c: any) => c.selector);
    const at = (id: string) => document.getElementById(id)!;
    const BG = "background: rgb(245, 238, 220)";

    it("finds a painted background under eight see-through layers", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      const layers = Array.from({ length: 8 }, (_, i) => `l${i}`);
      const nested = layers.reduceRight((inner, id) => `<div id="${id}">${inner}</div>`, "");
      document.body.innerHTML = `<div id="bg" style="${BG}">${nested}</div>`;
      const restore = emulateHitTest(() => [...[...layers].reverse().map(at), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#bg"]);
        expect((window as any).__HF_PICKER_API.pickAtPoint(10, 10)?.selector).toBe("#bg");
      } finally {
        restore();
      }
    });

    it("keeps a title and every box holding it, so a same-spot click still climbs", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="card"><h1 id="title">Hi</h1></div><div id="mask"></div>`;
      const restore = emulateHitTest(() => [at("mask"), at("title"), at("card")]);
      try {
        expect(selectorsAt()).toEqual(["#title", "#card"]);
      } finally {
        restore();
      }
    });

    it("drops a line whose words have not faded in and the see-through layer over it", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="scene" style="${BG}"><div id="mask"><div id="line">
        <span id="w1" style="opacity: 0">Imagine</span> <span id="w2" style="opacity: 0">you</span>
        </div></div></div>`;
      const restore = emulateHitTest(() => [at("w1"), at("line"), at("mask"), at("scene")]);
      try {
        expect(selectorsAt()).toEqual(["#scene"]);
      } finally {
        restore();
      }
    });

    // jsdom lays nothing out: each named text gets the glyph box Chromium would measure.
    function layOut(glyphs: Record<string, [number, number, number, number]>): () => void {
      const proto = Range.prototype as any;
      const select = proto.selectNodeContents;
      const placed = new WeakMap<Range, Node>();
      proto.selectNodeContents = function (this: Range, node: Node) {
        placed.set(this, node);
      };
      proto.getClientRects = function (this: Range) {
        const box = glyphs[placed.get(this)?.nodeValue?.trim() ?? ""];
        if (!box) return [];
        const [left, top, width, height] = box;
        return [{ left, top, width, height, right: left + width, bottom: top + height }];
      };
      return () => {
        proto.selectNodeContents = select;
        delete proto.getClientRects;
      };
    }

    it("counts text across its line boxes, and not the rest of its box", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"><p id="para">One line<br>Two line</p></div>`;
      const unlay = layOut({ "One line": [100, 100, 400, 46], "Two line": [100, 220, 380, 46] });
      const restore = emulateHitTest(() => [at("para"), at("bg")]);
      try {
        expect(selectorsAt(300, 120)).toEqual(["#para", "#bg"]);
        expect(selectorsAt(300, 183)).toEqual(["#para", "#bg"]);
        expect(selectorsAt(300, 600)).toEqual(["#bg"]);
      } finally {
        restore();
        unlay();
      }
    });

    it("does not count a layer's text that lays out no boxes (an SVG title, fallback content)", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"><h1 id="title">Hi</h1></div>
        <div id="layer"><span>Logo</span></div>`;
      const unlay = layOut({ Hi: [0, 0, 100, 40] });
      const restore = emulateHitTest(() => [at("layer"), at("title"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#title", "#bg"]);
      } finally {
        restore();
        unlay();
      }
    });

    it("keeps a box holding a drawn picture, though the box draws nothing itself", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="wrap"><img id="pic"></div><div id="mask"></div>`;
      const restore = emulateHitTest(() => [at("mask"), at("pic"), at("wrap")]);
      try {
        expect(selectorsAt()).toEqual(["#pic", "#wrap"]);
      } finally {
        restore();
      }
    });

    it("counts an SVG's shapes, not the SVG box around them", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"><h1 id="title">Hi</h1></div>
        <svg id="lines"><circle id="dot" r="4"></circle></svg>`;
      const restore = emulateHitTest(() => [at("lines"), at("title"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#title", "#bg"]);
      } finally {
        restore();
      }
      const onDot = emulateHitTest(() => [at("dot"), at("lines"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#dot", "#lines", "#bg"]);
      } finally {
        onDot();
      }
    });

    it("counts a border on its band, not across the box it frames", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="frame" style="border: 4px solid rgb(0, 200, 120)"></div>`;
      at("frame").getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect;
      const restore = emulateHitTest(() => [at("frame"), at("bg")]);
      try {
        expect(selectorsAt(50, 50)).toEqual(["#bg"]);
        expect(selectorsAt(2, 50)).toEqual(["#frame", "#bg"]);
      } finally {
        restore();
      }
    });

    it("does not count transparent text", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="ghost" style="color: transparent">Hidden words</div>`;
      const restore = emulateHitTest(() => [at("ghost"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#bg"]);
      } finally {
        restore();
      }
    });

    // jsdom computes neither text strokes nor pseudo-elements: lay the named properties over its style.
    // Keys are an element id, or an id and a pseudo-element ("icon::before").
    function styled(byKey: Record<string, Record<string, string>>): () => void {
      const real = window.getComputedStyle.bind(window);
      const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el, which) => {
        const style = real(el, which);
        const props = byKey[`${(el as Element).id}${which ?? ""}`];
        if (!props) return style;
        const camel = (name: string) =>
          name.replace(/^-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
        const own = Object.fromEntries(Object.entries(props).map(([k, v]) => [camel(k), v]));
        return new Proxy(style, {
          get: (target, key) => {
            if (key === "getPropertyValue")
              return (name: string) => props[name] ?? target.getPropertyValue(name);
            if (typeof key === "string" && key in own) return own[key];
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
      return () => spy.mockRestore();
    }

    it("counts outline text and fill-coloured text though their `color` is transparent", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="outline" style="color: transparent">Outline</div>
        <div id="filled" style="color: transparent">Filled</div>`;
      const unstyle = styled({
        outline: {
          "-webkit-text-stroke-width": "2px",
          "-webkit-text-stroke-color": "rgb(255, 0, 0)",
        },
        filled: { "-webkit-text-fill-color": "rgb(255, 0, 0)" },
      });
      let restore = emulateHitTest(() => [at("outline"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#outline", "#bg"]);
      } finally {
        restore();
      }
      restore = emulateHitTest(() => [at("filled"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#filled", "#bg"]);
      } finally {
        restore();
        unstyle();
      }
    });

    it("does not count a layer's out-of-flow boxes: their text is theirs, where they are", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"><h1 id="title">Hi</h1></div>
        <div id="captions"><p style="position: absolute">Caption words</p></div>
        <div id="banner"><p style="position: fixed">Banner words</p></div>`;
      const restore = emulateHitTest(() => [at("captions"), at("banner"), at("title"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#title", "#bg"]);
      } finally {
        restore();
      }
    });

    it("counts the gap between two words of a long split paragraph as the paragraph's", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      const words = Array.from({ length: 250 }, (_, i) => `<span>w${i}</span>`).join(" ");
      document.body.innerHTML = `<div id="bg" style="${BG}"><p id="para">${words}</p></div>`;
      const boxes: Record<string, [number, number, number, number]> = {};
      for (let i = 0; i < 250; i += 1)
        boxes[`w${i}`] = [40 + (i % 25) * 70, 100 + Math.floor(i / 25) * 60, 60, 40];
      const unlay = layOut(boxes);
      const restore = emulateHitTest(() => [at("para"), at("bg")]);
      try {
        // Between words 230 and 231, on the tenth line.
        expect(selectorsAt(455, 660)).toEqual(["#para", "#bg"]);
      } finally {
        restore();
        unlay();
      }
    });

    it("scales a border's band with the element", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="wide" style="border: 4px solid rgb(0, 200, 120)"></div>
        <div id="tall" style="border: 4px solid rgb(0, 200, 120)"></div>`;
      // Laid out 100px square; drawn at half width, and at half height.
      Object.defineProperty(at("wide"), "offsetWidth", { value: 100 });
      Object.defineProperty(at("wide"), "offsetHeight", { value: 100 });
      at("wide").getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 50, bottom: 100, width: 50, height: 100 }) as DOMRect;
      Object.defineProperty(at("tall"), "offsetWidth", { value: 100 });
      Object.defineProperty(at("tall"), "offsetHeight", { value: 100 });
      at("tall").getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 }) as DOMRect;
      let restore = emulateHitTest(() => [at("wide"), at("bg")]);
      try {
        expect(selectorsAt(3, 50)).toEqual(["#bg"]);
        expect(selectorsAt(1, 50)).toEqual(["#wide", "#bg"]);
        expect(selectorsAt(25, 3)).toEqual(["#wide", "#bg"]);
      } finally {
        restore();
      }
      restore = emulateHitTest(() => [at("tall"), at("bg")]);
      try {
        expect(selectorsAt(50, 3)).toEqual(["#bg"]);
        expect(selectorsAt(50, 1)).toEqual(["#tall", "#bg"]);
      } finally {
        restore();
      }
    });

    it("counts an SVG that paints its own background", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <svg id="panel" style="background-color: rgb(20, 20, 20)"></svg>`;
      const restore = emulateHitTest(() => [at("panel"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#panel", "#bg"]);
      } finally {
        restore();
      }
    });

    it("counts an SVG's text through the text element, not the SVG box", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div><svg id="art"><text>Label</text></svg>`;
      const restore = emulateHitTest(() => [at("art"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#bg"]);
      } finally {
        restore();
      }
    });

    // A glyph box under the pointer, in a box laid out far from it (moved by a transform): out of reach.
    it.each([
      ["a paragraph far below", { top: 800, bottom: 840, height: 40 }],
      [
        "a tall default-font box past the capped reach, about ten times its font",
        { top: 400, bottom: 700, height: 300 },
      ],
    ])("does not look for a layer's text in %s", (_, box) => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="layer"><div id="box"><p>Box words</p></div></div>`;
      at("box").getBoundingClientRect = () =>
        ({ left: 0, right: 600, width: 600, ...box }) as DOMRect;
      const unlay = layOut({ "Box words": [0, 0, 100, 40] });
      const restore = emulateHitTest(() => [at("layer"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#bg"]);
      } finally {
        restore();
        unlay();
      }
    });

    it("reaches a line box's leading from a big line in a small-font box", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"><div id="para">
        <div id="l1"><span>Line one</span></div><div id="l2"><span>Line two</span></div></div></div>`;
      // Two 120px lines, 100px apart, in boxes whose own font size is the default.
      at("l1").getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 600, bottom: 120, width: 600, height: 120 }) as DOMRect;
      at("l2").getBoundingClientRect = () =>
        ({ left: 0, top: 220, right: 600, bottom: 340, width: 600, height: 120 }) as DOMRect;
      const unlay = layOut({ "Line one": [0, 0, 600, 120], "Line two": [0, 220, 600, 120] });
      const restore = emulateHitTest(() => [at("para"), at("bg")]);
      try {
        expect(selectorsAt(300, 190)).toEqual(["#para", "#bg"]);
      } finally {
        restore();
        unlay();
      }
    });

    it("counts an inset shadow, not an outer one: an outer shadow draws outside the box", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="glow"></div><div id="well"></div>`;
      const unstyle = styled({
        glow: { "box-shadow": "rgb(255, 0, 0) 0px 0px 10px 0px" },
        well: { "box-shadow": "rgb(255, 0, 0) 0px 0px 10px 0px inset" },
      });
      let restore = emulateHitTest(() => [at("glow"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#bg"]);
      } finally {
        restore();
      }
      restore = emulateHitTest(() => [at("well"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#well", "#bg"]);
      } finally {
        restore();
        unstyle();
      }
    });

    it("counts pseudo content only when it is displayed and draws something", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"></div>
        <div id="empty"></div><div id="hidden"></div><div id="icon"></div>`;
      const unstyle = styled({
        "empty::after": { content: '""', display: "block" },
        "hidden::before": { content: '"*"', display: "none" },
        "icon::before": { content: '"*"', display: "inline" },
      });
      try {
        for (const [id, drawn] of [
          ["empty", false],
          ["hidden", false],
          ["icon", true],
        ] as const) {
          const restore = emulateHitTest(() => [at(id), at("bg")]);
          try {
            expect(selectorsAt()).toEqual(drawn ? [`#${id}`, "#bg"] : ["#bg"]);
          } finally {
            restore();
          }
        }
      } finally {
        unstyle();
      }
    });

    it("picks a shown child of a hidden parent: visibility can be turned back on below", () => {
      createPickerModule({ postMessage: createMockPostMessage() }).installPickerApi();
      document.body.innerHTML = `<div id="bg" style="${BG}"><div id="veil" style="visibility: hidden">
        <b id="back" style="visibility: visible">Back</b></div></div>`;
      const restore = emulateHitTest(() => [at("back"), at("veil"), at("bg")]);
      try {
        expect(selectorsAt()).toEqual(["#back", "#bg"]);
      } finally {
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

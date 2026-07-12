// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createTimelineElementFromManifestClip,
  parseTimelineFromDOM,
  createImplicitTimelineLayersFromDOM,
  buildStandaloneRootTimelineElement,
} from "./timelineDOM";

function makeDoc(html: string): Document {
  const d = document.implementation.createHTMLDocument();
  d.body.innerHTML = html;
  return d;
}

function makeLiveDoc(html: string): Document {
  document.head.innerHTML = "";
  document.body.innerHTML = html;
  return document;
}

function mockComputedZIndex(doc: Document, zIndexById: ReadonlyMap<string, string>): void {
  const win = doc.defaultView;
  if (!win) throw new Error("Expected document window");
  const original = win.getComputedStyle.bind(win);
  Object.defineProperty(win, "getComputedStyle", {
    configurable: true,
    value: (element: Element, pseudoElt?: string | null) => {
      const style = original(element, pseudoElt);
      const zIndex = zIndexById.get(element.id);
      if (zIndex != null) {
        Object.defineProperty(style, "zIndex", { configurable: true, value: zIndex });
      }
      return style;
    },
  });
}

describe("parseTimelineFromDOM — hfId from data-hf-id", () => {
  it("harvests hfId from a data-start element that has data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" data-hf-id="hf-abc123"></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);
    const hero = elements.find((el) => el.domId === "hero");

    expect(hero).toBeDefined();
    expect(hero?.hfId).toBe("hf-abc123");
  });

  it("leaves hfId undefined when element has no data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="plain" class="clip" data-start="0" data-duration="5"></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);
    const plain = elements.find((el) => el.domId === "plain");

    expect(plain).toBeDefined();
    expect(plain?.hfId).toBeUndefined();
  });

  it("ignores runtime-owned color grading canvases with timing attributes", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <img id="photo" class="clip" data-start="0" data-duration="5" />
        <canvas
          class="__hf_color_grading_canvas__"
          data-hf-color-grading-canvas="true"
          data-hyperframes-ignore
          data-start="0"
          data-duration="5"
        ></canvas>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);

    expect(elements.map((el) => el.tag)).toEqual(["img"]);
  });

  it("marks parsed timeline elements hidden when data-hidden is present", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" data-hidden></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);
    const hero = elements.find((el) => el.domId === "hero");

    expect(hero?.hidden).toBe(true);
  });

  it("marks manifest timeline elements hidden when the host has data-hidden", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" data-hidden></div>
      </div>
    `);
    const hostEl = doc.getElementById("hero");

    const element = createTimelineElementFromManifestClip({
      clip: {
        id: "hero",
        label: "Hero",
        kind: "element",
        tagName: "div",
        start: 0,
        duration: 5,
        track: 0,
        compositionId: null,
        parentCompositionId: null,
        compositionSrc: null,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl,
    });

    expect(element.hidden).toBe(true);
  });

  it("captures the effective z-index from the live element, not the runtime inline-only value", () => {
    // The runtime reports inline-only z-index (0 for CSS-rule authored z-index),
    // which must NOT override the live element's effective z-index — otherwise
    // the timeline collapses every CSS-styled clip to a z=0 tie and mis-orders.
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" style="z-index: 30"></div>
      </div>
    `);
    const hostEl = doc.getElementById("hero");

    const element = createTimelineElementFromManifestClip({
      clip: {
        id: "hero",
        label: "Hero",
        kind: "element",
        tagName: "div",
        start: 0,
        duration: 5,
        track: 0,
        zIndex: 0,
        compositionId: null,
        parentCompositionId: null,
        compositionSrc: null,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl,
    });

    expect(element.zIndex).toBe(30);
    expect(element.hasExplicitZIndex).toBe(true);
  });

  it("marks parsed inline, CSS-rule, and auto z-index authorship accurately", () => {
    const doc = makeLiveDoc(`
      <div data-composition-id="root">
        <div id="inline" class="clip" data-start="0" data-duration="2" style="z-index: 3"></div>
        <div id="rule" class="clip" data-start="0" data-duration="2"></div>
        <div id="auto" class="clip" data-start="0" data-duration="2"></div>
      </div>
    `);
    mockComputedZIndex(doc, new Map([["rule", "12"]]));

    const elements = parseTimelineFromDOM(doc, 10);

    expect(elements.find((el) => el.id === "inline")?.hasExplicitZIndex).toBe(true);
    expect(elements.find((el) => el.id === "rule")?.hasExplicitZIndex).toBe(true);
    expect(elements.find((el) => el.id === "auto")?.hasExplicitZIndex).toBe(false);
  });
});

describe("createImplicitTimelineLayersFromDOM — hfId from data-hf-id", () => {
  it("harvests hfId from an implicit layer child that has data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="layer" class="clip" data-hf-id="hf-xyz789"></div>
      </div>
    `);

    const layers = createImplicitTimelineLayersFromDOM(doc, 10);
    const layer = layers.find((el) => el.domId === "layer");

    expect(layer).toBeDefined();
    expect(layer?.hfId).toBe("hf-xyz789");
  });

  it("ignores runtime-owned color grading canvases as implicit layers", () => {
    const doc = makeDoc(`
      <div data-composition-id="root" data-duration="5">
        <img id="photo" class="clip" data-start="0" data-duration="5" />
        <canvas
          class="__hf_color_grading_canvas__"
          data-hf-color-grading-canvas="true"
          data-hyperframes-ignore
        ></canvas>
      </div>
    `);

    const layers = createImplicitTimelineLayersFromDOM(doc, 5);

    expect(layers).toEqual([]);
  });

  it("marks implicit layer CSS z-index authorship from computed style", () => {
    const doc = makeLiveDoc(`
      <div data-composition-id="root">
        <div id="layer" class="clip"></div>
      </div>
    `);
    mockComputedZIndex(doc, new Map([["layer", "8"]]));

    const layers = createImplicitTimelineLayersFromDOM(doc, 10);

    expect(layers[0]?.zIndex).toBe(8);
    expect(layers[0]?.hasExplicitZIndex).toBe(true);
  });
});

describe("buildStandaloneRootTimelineElement", () => {
  it("marks the standalone root as auto z-index", () => {
    const root = buildStandaloneRootTimelineElement({
      compositionId: "root",
      tagName: "div",
      rootDuration: 10,
      iframeSrc: "/preview/comp/index.html",
    });

    expect(root?.hasExplicitZIndex).toBe(false);
  });
});

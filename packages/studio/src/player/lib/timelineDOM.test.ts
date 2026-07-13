// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createTimelineElementFromManifestClip,
  parseTimelineFromDOM,
  createImplicitTimelineLayersFromDOM,
  mergeTimelineElementsPreservingDowngrades,
} from "./timelineDOM";
import type { TimelineElement } from "../store/playerStore";

function el(id: string, extra: Partial<TimelineElement> = {}): TimelineElement {
  return { id, tag: "img", start: 0, duration: 5, track: 0, ...extra };
}

function makeDoc(html: string): Document {
  const d = document.implementation.createHTMLDocument();
  d.body.innerHTML = html;
  return d;
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
});

describe("mergeTimelineElementsPreservingDowngrades — genuine removal vs transient downgrade", () => {
  it("drops a removed TOP-LEVEL element (undo of a split) instead of ghosting it", () => {
    const current = [el("a"), el("a-split")]; // post-split store: original + clone
    const next = [el("a")]; // fresh scan of the reverted file: clone gone
    const merged = mergeTimelineElementsPreservingDowngrades(current, next, 30, 30);
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });

  it("still preserves an enriched sub-composition child a bare re-scan drops", () => {
    const current = [el("a"), el("sub-child", { compositionSrc: "sub.html" })];
    const next = [el("a")]; // bare DOM scan misses the enriched sub-comp child
    const merged = mergeTimelineElementsPreservingDowngrades(current, next, 30, 30);
    expect(merged.map((e) => e.id).sort()).toEqual(["a", "sub-child"]);
  });

  it("trusts the fresh scan fully when it is not shorter", () => {
    const current = [el("a"), el("b", { compositionSrc: "sub.html" })];
    const next = [el("a"), el("c")];
    expect(
      mergeTimelineElementsPreservingDowngrades(current, next, 30, 30).map((e) => e.id),
    ).toEqual(["a", "c"]);
  });
});

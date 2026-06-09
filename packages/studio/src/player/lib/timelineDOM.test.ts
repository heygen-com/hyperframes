// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseTimelineFromDOM, createImplicitTimelineLayersFromDOM } from "./timelineDOM";

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
});

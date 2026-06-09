// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMissingCompositionElements } from "./timelineIframeHelpers";
import type { IframeWindow } from "./playbackTypes";

function makeDoc(html: string): Document {
  const d = document.implementation.createHTMLDocument();
  d.body.innerHTML = html;
  return d;
}

describe("buildMissingCompositionElements — hfId (R7)", () => {
  it("harvests hfId from data-hf-id on composition host elements", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-a"
          data-composition-src="scenes/a.html"
          data-hf-id="hf-scene1"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.hfId).toBe("hf-scene1");
  });

  it("leaves hfId undefined when element has no data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-b"
          data-composition-src="scenes/b.html"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.hfId).toBeUndefined();
  });
});

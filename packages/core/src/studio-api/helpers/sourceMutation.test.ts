import { describe, expect, it } from "vitest";
import { removeElementFromHtml } from "./sourceMutation.js";

describe("removeElementFromHtml", () => {
  it("removes a self-closing element by id", () => {
    const html = `<!doctype html><html><body><div data-composition-id="main"><img id="photo" src="asset.png" /><div id="rest"></div></div></body></html>`;

    const updated = removeElementFromHtml(html, { id: "photo" });

    expect(updated).not.toContain(`id="photo"`);
    expect(updated).toContain(`id="rest"`);
  });

  it("removes a matched composition host by selector", () => {
    const html = `<!doctype html><html><body><div data-composition-id="main"><div data-composition-id="scene-a"><span>Scene A</span></div><div data-composition-id="scene-b"></div></div></body></html>`;

    const updated = removeElementFromHtml(html, {
      selector: '[data-composition-id="scene-a"]',
    });

    expect(updated).not.toContain(`data-composition-id="scene-a"`);
    expect(updated).toContain(`data-composition-id="scene-b"`);
  });

  it("supports fragment html by returning updated body markup", () => {
    const html = `<div id="photo"></div><div id="rest"></div>`;

    expect(removeElementFromHtml(html, { id: "photo" })).toBe(`<div id="rest"></div>`);
  });
});

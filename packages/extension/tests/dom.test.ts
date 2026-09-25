// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { serializeEditableDom } from "../src/capture/dom";

function visible(element: Element, left = 20, top = 30, width = 320, height = 180): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(left, top, width, height),
  });
}

describe("serializeEditableDom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
  });

  it("keeps semantic text editable while removing executable markup", () => {
    const root = document.createElement("section");
    root.innerHTML = '<h2 data-hf-id="foreign">Editable title</h2><script>evil()</script>';
    visible(root);
    visible(root.querySelector("h2")!);
    document.body.append(root);

    const result = serializeEditableDom(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.html).toContain("Editable title");
    expect(result.capture.html).not.toContain("script");
    expect(result.capture.html).not.toContain("foreign");
  });

  it("replaces canvas with a bounded local-resource placeholder", () => {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    root.append(canvas);
    visible(root);
    visible(canvas, 40, 50, 200, 100);
    document.body.append(root);

    const result = serializeEditableDom(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.html).toContain('data-hf-resource-id="opaque-1"');
    expect(result.capture.html).toContain('data-hf-captured-tag="canvas"');
    expect(result.capture.opaqueIslands).toEqual([
      {
        id: "opaque-1",
        rect: expect.objectContaining({ left: 40, top: 50, width: 200, height: 100 }),
      },
    ]);
  });

  it("promotes a canvas to one editable model island when a GLB was localized", () => {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    root.append(canvas);
    visible(root);
    visible(canvas, 40, 50, 200, 100);
    document.body.append(root);

    const result = serializeEditableDom(root, {
      mime: "model/gltf-binary",
      bytes: 4,
      data: "Z2xURg==",
      sourceName: "phone.glb",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.html).toContain('data-hf-model-resource-id="model-1"');
    expect(result.capture.html).not.toContain("data-hf-resource-id");
    expect(result.capture.opaqueIslands).toEqual([]);
    expect(result.capture.modelIslands).toEqual([
      expect.objectContaining({ id: "model-1", sourceName: "phone.glb" }),
    ]);
  });

  it("anchors children when a detached subgrid loses its parent tracks", () => {
    const root = document.createElement("section");
    root.style.cssText = "display:grid;grid-template-rows:subgrid";
    const title = document.createElement("h2");
    title.style.gridArea = "headline";
    title.textContent = "Still editable";
    root.append(title);
    visible(root, 100, 120, 372, 732);
    visible(title, 128, 144, 316, 32);
    document.body.append(root);

    const result = serializeEditableDom(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.html).toContain("Still editable");
    expect(result.capture.html).toMatch(/display:block[^"]*grid-template-rows:none/);
    expect(result.capture.html).toMatch(
      /data-hf-captured-tag="h2"[^>]*position:absolute[^"]*left:28px[^"]*top:24px/,
    );
  });

  it("localizes the first painted ancestor backdrop onto a transparent root", () => {
    const backdrop = document.createElement("div");
    backdrop.style.backgroundColor = "rgb(245, 245, 247)";
    const root = document.createElement("article");
    root.textContent = "Dark text on inherited paper";
    backdrop.append(root);
    document.body.append(backdrop);
    visible(root);

    const result = serializeEditableDom(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.html).toContain("background-color:rgb(245, 245, 247)");
  });
});

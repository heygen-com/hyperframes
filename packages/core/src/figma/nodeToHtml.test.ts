// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nodeToHtml } from "./nodeToHtml";
import type { FigmaNodeDocument } from "./client";

const BOX = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const SOLID_BLUE = { type: "SOLID", color: { r: 0, g: 0.4, b: 1, a: 1 } };

function frame(children: FigmaNodeDocument[]): FigmaNodeDocument {
  return {
    id: "1:1",
    name: "Hero Card",
    type: "FRAME",
    absoluteBoundingBox: BOX(100, 200, 800, 600),
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    children,
  };
}

describe("nodeToHtml", () => {
  it("renders the root frame at exact size with a stable id", () => {
    const out = nodeToHtml(frame([]), { resolved: [], unresolved: [] });
    expect(out.html).toContain('id="hero-card"');
    expect(out.html).toContain('data-figma-id="1:1"');
    expect(out.html).toContain("width: 800px");
    expect(out.html).toContain("height: 600px");
    expect(out.html).toContain("position: relative");
    expect(out.html).toContain("background: #FFFFFF");
  });

  it("absolutely positions children relative to the root frame", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "Badge",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(140, 260, 120, 40),
          fills: [SOLID_BLUE],
          cornerRadius: 8,
          opacity: 0.9,
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.html).toContain("left: 40px");
    expect(out.html).toContain("top: 60px");
    expect(out.html).toContain("width: 120px");
    expect(out.html).toContain("border-radius: 8px");
    expect(out.html).toContain("opacity: 0.9");
    expect(out.html).toContain("background: #0066FF");
  });

  it("emits var() with literal fallback for resolved bindings", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "Badge",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(100, 200, 10, 10),
          fills: [SOLID_BLUE],
        },
      ]),
      {
        resolved: [
          {
            nodeId: "1:2",
            property: "fills",
            figmaId: "VariableID:1:1",
            compositionVariableId: "figma:Blue/500",
          },
        ],
        unresolved: [],
      },
    );
    expect(out.html).toContain("background: var(--figma-blue-500, #0066FF)");
  });

  it("bakes literals and flags unresolved bindings — never a dangling var()", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "Badge",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(100, 200, 10, 10),
          fills: [SOLID_BLUE],
        },
      ]),
      {
        resolved: [],
        unresolved: [{ nodeId: "1:2", property: "fills", figmaId: "VariableID:9:9" }],
      },
    );
    expect(out.html).toContain("background: #0066FF");
    expect(out.html).not.toContain("var(");
    expect(out.html).toContain('data-figma-unresolved="fills"');
  });

  it("renders text with font styles and escaped content", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:3",
          name: "Title",
          type: "TEXT",
          absoluteBoundingBox: BOX(100, 200, 300, 50),
          characters: "Ship <fast> & true",
          style: {
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 32,
            lineHeightPx: 40,
            letterSpacing: -0.5,
          },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.html).toContain("Ship &lt;fast&gt; &amp; true");
    expect(out.html).toContain("font-family: 'Inter'");
    expect(out.html).toContain("font-weight: 700");
    expect(out.html).toContain("font-size: 32px");
    expect(out.html).toContain("line-height: 40px");
    expect(out.html).toContain("color: #000000");
  });

  it("routes vectors to the rasterize list with an img placeholder", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:4",
          name: "Logo Mark",
          type: "VECTOR",
          absoluteBoundingBox: BOX(120, 220, 64, 64),
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.rasterize).toEqual([{ nodeId: "1:4", name: "Logo Mark", slug: "logo-mark" }]);
    expect(out.html).toContain('data-figma-rasterize="1:4"');
    expect(out.html).toContain("<img");
  });

  it("skips invisible nodes and invisible fills (respects visible:false)", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:5",
          name: "Hidden",
          type: "RECTANGLE",
          visible: false,
          absoluteBoundingBox: BOX(0, 0, 5, 5),
          fills: [SOLID_BLUE],
        },
        {
          id: "1:6",
          name: "NoFill",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(100, 200, 5, 5),
          fills: [{ ...SOLID_BLUE, visible: false }],
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.html).not.toContain("1:5");
    expect(out.html).toContain('data-figma-id="1:6"');
    expect(out.html).not.toContain("background: #0066FF");
  });

  it("maps linear gradients and drop shadows", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:7",
          name: "Grad",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(100, 200, 10, 10),
          fills: [
            {
              type: "GRADIENT_LINEAR",
              gradientStops: [
                { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
                { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
              ],
            },
          ],
          effects: [
            {
              type: "DROP_SHADOW",
              color: { r: 0, g: 0, b: 0, a: 0.25 },
              offset: { x: 0, y: 4 },
              radius: 12,
            },
          ],
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.html).toContain("linear-gradient(180deg, #FF0000 0%, #0000FF 100%)");
    expect(out.html).toContain("box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.25)");
  });
});

describe("nodeToHtml review fixes", () => {
  it("routes TEXT color through the binding-aware path (var() when resolved)", () => {
    const text: FigmaNodeDocument = {
      id: "2:1",
      name: "Title",
      type: "TEXT",
      absoluteBoundingBox: BOX(0, 0, 100, 20),
      fills: [SOLID_BLUE],
      characters: "Hi",
    };
    const { html } = nodeToHtml(frame([text]), {
      resolved: [
        { nodeId: "2:1", property: "fills", figmaId: "V:1", compositionVariableId: "figma:Ink" },
      ],
      unresolved: [],
    });
    expect(html).toContain("color: var(--figma-ink,");
  });

  it("renders ELLIPSE with border-radius 50%", () => {
    const ellipse: FigmaNodeDocument = {
      id: "2:2",
      name: "Dot",
      type: "ELLIPSE",
      absoluteBoundingBox: BOX(0, 0, 10, 10),
      fills: [SOLID_BLUE],
    };
    const { html } = nodeToHtml(frame([ellipse]), { resolved: [], unresolved: [] });
    expect(html).toContain("border-radius: 50%");
  });

  it("emits overflow hidden for clipsContent frames", () => {
    const clipped = { ...frame([]), clipsContent: true };
    const { html } = nodeToHtml(clipped, { resolved: [], unresolved: [] });
    expect(html).toContain("overflow: hidden");
  });

  it("neutralizes a hostile fontFamily instead of breaking out of the style attribute", () => {
    const text: FigmaNodeDocument = {
      id: "2:3",
      name: "Evil",
      type: "TEXT",
      absoluteBoundingBox: BOX(0, 0, 100, 20),
      style: { fontFamily: `Mal"; onerror="alert(1)` },
      characters: "x",
    };
    const { html } = nodeToHtml(frame([text]), { resolved: [], unresolved: [] });
    expect(html).not.toContain('onerror="');
    expect(html).not.toMatch(/style="[^"]*" onerror/);
  });
});

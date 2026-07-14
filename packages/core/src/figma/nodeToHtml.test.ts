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
    expect(out.html).toContain("background-color: #FFFFFF");
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
    expect(out.html).toContain("background-color: #0066FF");
  });

  it("positions nested children relative to their PARENT, not the root", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "Group",
          type: "FRAME",
          absoluteBoundingBox: BOX(600, 400, 300, 200),
          children: [
            {
              id: "1:3",
              name: "Inner",
              type: "RECTANGLE",
              absoluteBoundingBox: BOX(620, 440, 100, 40),
              fills: [SOLID_BLUE],
            },
          ],
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    // Group at canvas (600,400) inside root (100,200) → left 500, top 200.
    expect(out.html).toContain("left: 500px");
    expect(out.html).toContain("top: 200px");
    // Inner at canvas (620,440) inside Group (600,400) → left 20, top 40 —
    // NOT root-relative 520/240, which double-offsets when CSS resolves
    // absolute position against the positioned parent.
    expect(out.html).toContain("left: 20px");
    expect(out.html).toContain("top: 40px");
    expect(out.html).not.toContain("left: 520px");
  });

  it("prefixes digit-leading slugs so ids stay CSS-selector-safe", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "3D Object - Headphones",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(120, 220, 100, 40),
          fills: [SOLID_BLUE],
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    // "#3d-object-headphones" would throw in querySelector/GSAP targeting
    expect(out.html).toContain('id="n3d-object-headphones"');
    expect(out.html).not.toContain('id="3d-object-headphones"');
  });

  it("emits text-box-trim for vertically trimmed text (box height < line-height)", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "Headline",
          type: "TEXT",
          absoluteBoundingBox: BOX(140, 260, 304, 51),
          fills: [SOLID_BLUE],
          characters: "Unlocked",
          style: { fontFamily: "Inter", fontWeight: 700, fontSize: 70, lineHeightPx: 66.5 },
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    // figma's trimmed bounds (51px box for a 66.5px line) place cap height at
    // the box top; browsers overflow the glyphs below without text-box-trim
    expect(out.html).toContain("text-box-trim: trim-both");
    expect(out.html).toContain("text-box-edge: cap alphabetic");
  });

  it("does not trim text whose box matches its line-height", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:2",
          name: "Body",
          type: "TEXT",
          absoluteBoundingBox: BOX(140, 260, 304, 39),
          fills: [SOLID_BLUE],
          characters: "Subtitle",
          style: { fontFamily: "Inter", fontWeight: 400, fontSize: 32, lineHeightPx: 38.4 },
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.html).not.toContain("text-box-trim");
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
    expect(out.html).toContain("background-color: var(--figma-blue-500, #0066FF)");
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
    expect(out.html).toContain("background-color: #0066FF");
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

  it("routes IMAGE fills to the rasterize list regardless of node.type", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:8",
          name: "Sneaker Photo",
          type: "RECTANGLE",
          absoluteBoundingBox: BOX(120, 220, 200, 200),
          fills: [{ type: "IMAGE", imageRef: "abc123" }],
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.rasterize).toEqual([
      { nodeId: "1:8", name: "Sneaker Photo", slug: "sneaker-photo" },
    ]);
    expect(out.html).toContain('data-figma-rasterize="1:8"');
    expect(out.html).toContain("<img");
  });

  it("does not double-paint a rasterized node's own fill/corner-radius onto its img", () => {
    const out = nodeToHtml(
      frame([
        {
          id: "1:9",
          name: "Blob",
          type: "VECTOR",
          absoluteBoundingBox: BOX(120, 220, 64, 64),
          fills: [SOLID_BLUE],
          cornerRadius: 12,
          opacity: 0.5,
        },
      ]),
      { resolved: [], unresolved: [] },
    );
    expect(out.html).not.toContain("background-color: #0066FF");
    expect(out.html).not.toContain("border-radius: 12px");
    // opacity is compositing, not shape — still applies on top of the export
    expect(out.html).toContain("opacity: 0.5");
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
    expect(out.html).not.toContain("background-color: #0066FF");
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

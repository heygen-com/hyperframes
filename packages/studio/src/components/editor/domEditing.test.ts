import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  buildDomEditMovePatchOperations,
  buildDomEditResizePatchOperations,
  buildDomEditStylePatchOperation,
  buildElementAgentPrompt,
  findElementForSelection,
  isTextEditableSelection,
  serializeDomEditTextFields,
  type DomEditSelection,
  resolveDomEditCapabilities,
  resolveDomEditSelection,
} from "./domEditing";

function createDocument(markup: string): Document {
  const window = new Window();
  Object.assign(window, { SyntaxError });
  window.document.body.innerHTML = markup;
  return window.document;
}

describe("resolveDomEditCapabilities", () => {
  it("marks absolute px-positioned layers as movable and resizable", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#card",
        inlineStyles: {
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
        },
        computedStyles: {
          position: "absolute",
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
          transform: "none",
        },
        isCompositionHost: false,
        isMasterView: false,
      }),
    ).toEqual({
      canSelect: true,
      canEditStyles: true,
      canMove: true,
      canResize: true,
      canDetachFromLayout: false,
      reasonIfDisabled: undefined,
    });
  });

  it("rejects flex/grid children for move and resize", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#chip",
        tagName: "div",
        inlineStyles: {},
        computedStyles: {
          position: "static",
          display: "block",
          left: "auto",
          top: "auto",
          width: "180px",
          height: "64px",
          transform: "none",
        },
        isCompositionHost: false,
        isMasterView: false,
      }),
    ).toMatchObject({
      canSelect: true,
      canEditStyles: true,
      canMove: false,
      canResize: false,
      canDetachFromLayout: true,
      reasonIfDisabled: "This layer is controlled by layout.",
    });
  });

  it("rejects transform-driven geometry", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#card",
        inlineStyles: {
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
        },
        computedStyles: {
          position: "absolute",
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
          transform: "matrix(1, 0, 0, 1, 12, 0)",
        },
        isCompositionHost: false,
        isMasterView: false,
      }),
    ).toMatchObject({
      canMove: false,
      canResize: false,
      canDetachFromLayout: false,
    });
  });

  it("treats identity transforms left behind by animation libraries as movable", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#card",
        inlineStyles: {
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
        },
        computedStyles: {
          position: "absolute",
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
          transform: "matrix(1, 0, 0, 1, 0, 0)",
        },
        isCompositionHost: false,
        isMasterView: false,
      }),
    ).toMatchObject({
      canMove: true,
      canResize: true,
      canDetachFromLayout: false,
    });
  });

  it("treats identity matrix3d transforms as movable", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#card",
        inlineStyles: {
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
        },
        computedStyles: {
          position: "absolute",
          left: "120px",
          top: "80px",
          width: "240px",
          height: "140px",
          transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
        },
        isCompositionHost: false,
        isMasterView: false,
      }),
    ).toMatchObject({
      canMove: true,
      canResize: true,
    });
  });

  it("allows imported absolute media to resize from computed px geometry", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#photo",
        inlineStyles: {
          inset: "0",
          width: "100%",
          height: "100%",
        },
        computedStyles: {
          position: "absolute",
          left: "0px",
          top: "0px",
          width: "330px",
          height: "228px",
          transform: "none",
        },
        isCompositionHost: false,
        isMasterView: false,
      }),
    ).toMatchObject({
      canMove: true,
      canResize: true,
    });
  });
});

describe("resolveDomEditSelection", () => {
  it("allows moving composition hosts in master view while keeping contents drill-down only", () => {
    expect(
      resolveDomEditCapabilities({
        selector: "#detail-host",
        inlineStyles: {
          left: "80px",
          top: "60px",
          width: "320px",
          height: "220px",
        },
        computedStyles: {
          position: "absolute",
          left: "80px",
          top: "60px",
          width: "320px",
          height: "220px",
          transform: "none",
        },
        isCompositionHost: true,
        isMasterView: true,
      }),
    ).toEqual({
      canSelect: true,
      canEditStyles: false,
      canMove: true,
      canResize: true,
      canDetachFromLayout: false,
      reasonIfDisabled: undefined,
    });
  });

  it("resolves child clicks inside a composition host back to the host in master view", () => {
    const document = createDocument(`
      <div data-composition-id="main">
        <div id="detail-host" data-composition-src="compositions/detail-card.html">
          <span id="inner-copy">Nested scene</span>
        </div>
      </div>
    `);

    const child = document.getElementById("inner-copy") as HTMLElement;
    const selection = resolveDomEditSelection(child, {
      activeCompositionPath: null,
      isMasterView: true,
    });

    expect(selection?.id).toBe("detail-host");
    expect(selection?.isCompositionHost).toBe(true);
    expect(selection?.capabilities.canMove).toBe(false);
    expect(selection?.capabilities.canEditStyles).toBe(false);
  });

  it("scopes class selector indexing to the same source file", () => {
    const document = createDocument(`
      <div data-composition-id="main">
        <div class="chip">Root chip</div>
        <div data-composition-id="nested" data-composition-file="compositions/nested.html">
          <div class="chip">Nested chip</div>
        </div>
      </div>
    `);

    const rootChip = document.getElementsByClassName("chip")[0] as HTMLElement;
    const selection = resolveDomEditSelection(rootChip, {
      activeCompositionPath: null,
      isMasterView: true,
    });

    expect(selection?.sourceFile).toBe("index.html");
    expect(selection?.selector).toBe(".chip");
    expect(selection?.selectorIndex).toBe(0);
    expect(findElementForSelection(document, selection!, null)).toBe(rootChip);
  });

  it("prefers the nearest clip ancestor on single-click style selection", () => {
    const document = createDocument(`
      <section id="card" class="clip" style="left: 10px; top: 20px; width: 200px; height: 100px; position: absolute;">
        <p id="copy">Hello</p>
      </section>
    `);

    const child = document.getElementById("copy") as HTMLElement;
    const selection = resolveDomEditSelection(child, {
      activeCompositionPath: null,
      isMasterView: false,
      preferClipAncestor: true,
    });

    expect(selection?.id).toBe("card");
    expect(selection?.selector).toBe("#card");
  });

  it("can resolve the exact child when clip-ancestor preference is disabled", () => {
    const document = createDocument(`
      <section id="card" class="clip" style="left: 10px; top: 20px; width: 200px; height: 100px; position: absolute;">
        <p id="copy">Hello</p>
      </section>
    `);

    const child = document.getElementById("copy") as HTMLElement;
    const selection = resolveDomEditSelection(child, {
      activeCompositionPath: null,
      isMasterView: false,
      preferClipAncestor: false,
    });

    expect(selection?.id).toBe("copy");
    expect(selection?.selector).toBe("#copy");
  });

  it("collects simple child text blocks as separate editable fields", () => {
    const document = createDocument(`
      <section id="card" class="clip" style="left: 10px; top: 20px; width: 200px; height: 100px; position: absolute;">
        <strong>Headline</strong>
        <span>Supporting copy</span>
      </section>
    `);

    const selection = resolveDomEditSelection(document.getElementById("card") as HTMLElement, {
      activeCompositionPath: null,
      isMasterView: false,
    });

    expect(selection?.textFields.map((field) => field.label)).toEqual(["Text 1", "Text 2"]);
    expect(selection?.textFields.map((field) => field.value)).toEqual([
      "Headline",
      "Supporting copy",
    ]);
  });

  it("preserves user-entered text spacing in editable text fields", () => {
    const document = createDocument(`
      <section id="card" class="clip" style="position: absolute;">
        <strong>Headline with trailing space </strong>
      </section>
    `);

    const selection = resolveDomEditSelection(document.getElementById("card") as HTMLElement, {
      activeCompositionPath: null,
      isMasterView: false,
    });

    expect(selection?.textFields[0]?.value).toBe("Headline with trailing space ");
  });

  it("keeps an emptied text layer editable so users can type into it again", () => {
    const document = createDocument(`
      <div id="card" class="clip" style="position: absolute;"></div>
    `);

    const selection = resolveDomEditSelection(document.getElementById("card") as HTMLElement, {
      activeCompositionPath: null,
      isMasterView: false,
    });

    expect(selection?.textFields).toMatchObject([
      {
        key: "self:0:div",
        label: "Content",
        value: "",
        source: "self",
      },
    ]);
    expect(selection ? isTextEditableSelection(selection) : false).toBe(true);
  });

  it("keeps emptied child text layers editable after their content is cleared", () => {
    const document = createDocument(`
      <div id="card" class="clip" style="position: absolute;">
        <strong></strong>
        <span></span>
      </div>
    `);

    const selection = resolveDomEditSelection(document.getElementById("card") as HTMLElement, {
      activeCompositionPath: null,
      isMasterView: false,
    });

    expect(selection?.textFields.map((field) => field.tagName)).toEqual(["strong", "span"]);
    expect(selection?.textFields.map((field) => field.value)).toEqual(["", ""]);
  });
});

describe("patch builders and prompt builder", () => {
  it("builds move patch operations for left/top", () => {
    expect(buildDomEditMovePatchOperations(140.4, 82.1)).toEqual([
      { type: "inline-style", property: "left", value: "140px" },
      { type: "inline-style", property: "top", value: "82px" },
    ]);
  });

  it("builds resize patch operations for width/height", () => {
    expect(buildDomEditResizePatchOperations(301.6, 210.1)).toEqual([
      { type: "inline-style", property: "width", value: "302px" },
      { type: "inline-style", property: "height", value: "210px" },
    ]);
  });

  it("builds style patch operations", () => {
    expect(buildDomEditStylePatchOperation("background-color", "rgb(15, 23, 42)")).toEqual({
      type: "inline-style",
      property: "background-color",
      value: "rgb(15, 23, 42)",
    });
  });

  it("builds an agent prompt with source and selector context", () => {
    const selection = {
      element: {} as HTMLElement,
      id: "editable-card",
      selector: "#editable-card",
      selectorIndex: undefined,
      sourceFile: "index.html",
      compositionPath: "index.html",
      compositionSrc: undefined,
      isCompositionHost: false,
      label: "Drag me first",
      tagName: "div",
      boundingBox: { x: 108, y: 112, width: 380, height: 196 },
      textContent: "Drag me first",
      dataAttributes: {},
      inlineStyles: {
        left: "108px",
        top: "112px",
        width: "380px",
        height: "196px",
      },
      computedStyles: {
        position: "absolute",
        left: "108px",
        top: "112px",
        width: "380px",
        height: "196px",
        color: "rgb(248, 250, 252)",
      },
      textFields: [
        {
          key: "self:0:div",
          label: "Content",
          value: "Drag me first",
          tagName: "div",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "self",
        },
      ],
      capabilities: {
        canSelect: true,
        canEditStyles: true,
        canMove: true,
        canResize: true,
      },
    } satisfies DomEditSelection;

    const prompt = buildElementAgentPrompt({
      selection,
      currentTime: 1.25,
      tagSnippet: `<div id="editable-card" style="position:absolute; left: 108px; top: 112px; width: 380px; height: 196px; color: rgb(248, 250, 252)"`,
    });

    expect(prompt).toContain("## HyperFrames element edit request v1");
    expect(prompt).toContain("Schema version: 1");
    expect(prompt).toContain("Source file: index.html");
    expect(prompt).toContain("Selector: #editable-card");
    expect(prompt).toContain("Playback time:");
    expect(prompt).toContain("Text fields:");
    expect(prompt).toContain('key=self:0:div; tag=<div>; source=self; text="Drag me first"');
    expect(prompt).toContain("Inline styles:");
    expect(prompt).toContain("Computed styles (browser-resolved):");
    expect(prompt).toContain("Target HTML:");
    expect(prompt).toContain("Guardrails:");
    expect(prompt).toContain("Do not modify other elements' data-* attributes or positioning.");
  });

  it("serializes child text fields back into HTML", () => {
    expect(
      serializeDomEditTextFields([
        {
          key: "child:0:strong",
          label: "Text 1",
          value: "Headline <1>",
          tagName: "strong",
          attributes: [],
          inlineStyles: {
            "font-size": "22px",
          },
          computedStyles: {},
          source: "child",
        },
        {
          key: "child:1:span",
          label: "Text 2",
          value: "Details & more",
          tagName: "span",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "child",
        },
      ]),
    ).toBe(
      '<strong data-hf-text-key="child:0:strong" style="font-size: 22px">Headline &lt;1&gt;</strong><span data-hf-text-key="child:1:span">Details &amp; more</span>',
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { DomEditSelection } from "./domEditing";
import {
  STUDIO_OFFSET_X_PROP,
  STUDIO_OFFSET_Y_PROP,
  STUDIO_ROTATION_PROP,
  STUDIO_WIDTH_PROP,
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  applyStudioManualEditManifest,
  applyStudioPathOffset,
  applyStudioPathOffsetDraft,
  applyStudioRotation,
  applyStudioRotationDraft,
  beginStudioManualEditGesture,
  captureStudioBoxSize,
  captureStudioRotation,
  emptyStudioManualEditManifest,
  endStudioManualEditGesture,
  installStudioManualEditSeekReapply,
  isStudioManualEditManifestPath,
  parseStudioManualEditManifest,
  readStudioFileChangePath,
  readStudioBoxSize,
  readStudioPathOffset,
  readStudioRotation,
  removeStudioManualEditsForSelection,
  restoreStudioBoxSize,
  restoreStudioRotation,
  serializeStudioManualEditManifest,
  upsertStudioBoxSizeEdit,
  upsertStudioPathOffsetEdit,
  upsertStudioRotationEdit,
} from "./manualEdits";

function createDocument(markup: string): Document {
  const window = new Window();
  window.document.body.innerHTML = markup;
  return window.document;
}

function createSelection(): DomEditSelection {
  return {
    element: {} as HTMLElement,
    id: "card",
    selector: "#card",
    selectorIndex: undefined,
    sourceFile: "index.html",
    compositionPath: "index.html",
    compositionSrc: undefined,
    isCompositionHost: false,
    label: "Card",
    tagName: "div",
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canMove: false,
      canResize: false,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

function mockBoundingRect(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function mockComputedStyle(element: HTMLElement, values: Record<string, string>): void {
  const win = element.ownerDocument.defaultView;
  if (!win) throw new Error("defaultView fixture missing");
  win.getComputedStyle = ((target: Element) =>
    ({
      getPropertyValue: (property: string) => (target === element ? (values[property] ?? "") : ""),
    }) as CSSStyleDeclaration) as typeof win.getComputedStyle;
}

describe("studio manual edits", () => {
  it("upserts path offsets by stable target", () => {
    const manifest = upsertStudioPathOffsetEdit(
      emptyStudioManualEditManifest(),
      createSelection(),
      {
        x: 12.4,
        y: 30.6,
      },
    );
    const updated = upsertStudioPathOffsetEdit(manifest, createSelection(), {
      x: 20,
      y: 42,
    });

    expect(updated.edits).toHaveLength(1);
    expect(updated.edits[0]).toMatchObject({
      kind: "path-offset",
      target: { sourceFile: "index.html", selector: "#card", id: "card" },
      x: 20,
      y: 42,
    });
  });

  it("upserts box sizes without replacing path offsets for the same target", () => {
    const selection = createSelection();
    const manifest = upsertStudioPathOffsetEdit(emptyStudioManualEditManifest(), selection, {
      x: 12,
      y: 30,
    });
    const updated = upsertStudioBoxSizeEdit(manifest, selection, {
      width: 240.4,
      height: 120.6,
    });
    const resized = upsertStudioBoxSizeEdit(updated, selection, {
      width: 260,
      height: 140,
    });

    expect(resized.edits).toHaveLength(2);
    expect(resized.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "path-offset", x: 12, y: 30 }),
        expect.objectContaining({ kind: "box-size", width: 260, height: 140 }),
      ]),
    );
  });

  it("upserts rotations without replacing other manual edits for the same target", () => {
    const selection = createSelection();
    const manifest = upsertStudioPathOffsetEdit(emptyStudioManualEditManifest(), selection, {
      x: 12,
      y: 30,
    });
    const resized = upsertStudioBoxSizeEdit(manifest, selection, {
      width: 240,
      height: 120,
    });
    const rotated = upsertStudioRotationEdit(resized, selection, { angle: 32.34 });
    const updated = upsertStudioRotationEdit(rotated, selection, { angle: -14.96 });

    expect(updated.edits).toHaveLength(3);
    expect(updated.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "path-offset", x: 12, y: 30 }),
        expect.objectContaining({ kind: "box-size", width: 240, height: 120 }),
        expect.objectContaining({ kind: "rotation", angle: -15 }),
      ]),
    );
  });

  it("removes all manual edits for the selected target", () => {
    const selection = createSelection();
    const otherSelection = {
      ...createSelection(),
      id: "other-card",
      selector: "#other-card",
      label: "Other card",
    };
    const moved = upsertStudioPathOffsetEdit(emptyStudioManualEditManifest(), selection, {
      x: 12,
      y: 30,
    });
    const resized = upsertStudioBoxSizeEdit(moved, selection, {
      width: 240,
      height: 120,
    });
    const rotated = upsertStudioRotationEdit(resized, selection, { angle: 32 });
    const manifest = upsertStudioPathOffsetEdit(rotated, otherSelection, { x: 4, y: 8 });

    const updated = removeStudioManualEditsForSelection(manifest, selection);

    expect(updated.edits).toHaveLength(1);
    expect(updated.edits[0]).toMatchObject({
      kind: "path-offset",
      target: { id: "other-card", selector: "#other-card" },
      x: 4,
      y: 8,
    });
  });

  it("round-trips valid manifest entries and drops invalid entries", () => {
    const content = serializeStudioManualEditManifest({
      version: 1,
      edits: [
        {
          kind: "path-offset",
          target: { sourceFile: "index.html", selector: "#card", id: "card" },
          x: 10,
          y: 20,
        },
        {
          kind: "box-size",
          target: { sourceFile: "index.html", selector: "#card", id: "card" },
          width: 320,
          height: 180,
        },
        {
          kind: "rotation",
          target: { sourceFile: "index.html", selector: "#card", id: "card" },
          angle: 22.5,
        },
      ],
    });

    expect(parseStudioManualEditManifest(content).edits).toHaveLength(3);
    expect(parseStudioManualEditManifest('{ "edits": [{ "kind": "path-offset" }] }').edits).toEqual(
      [],
    );
  });

  it("recognizes manual edit manifest file-change payloads", () => {
    expect(readStudioFileChangePath({ path: ".hyperframes/studio-manual-edits.json" })).toBe(
      ".hyperframes/studio-manual-edits.json",
    );
    expect(readStudioFileChangePath({ data: '{"path":"nested/file.html"}' })).toBe(
      "nested/file.html",
    );
    expect(
      isStudioManualEditManifestPath(
        "/Users/example/project/.hyperframes/studio-manual-edits.json",
      ),
    ).toBe(true);
    expect(isStudioManualEditManifestPath("index.html")).toBe(false);
  });

  it("applies offsets through CSS translate longhand", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;

    applyStudioPathOffset(card, { x: 14, y: -8 });

    expect(readStudioPathOffset(card)).toEqual({ x: 14, y: -8 });
    expect(card.style.getPropertyValue(STUDIO_OFFSET_X_PROP)).toBe("14px");
    expect(card.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)).toBe("-8px");
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_X_PROP);
  });

  it("preserves authored inline translate as the additive path offset base", () => {
    const document = createDocument(`<div id="card" style="translate: 10px 20px"></div>`);
    const card = document.getElementById("card") as HTMLElement;

    applyStudioPathOffset(card, { x: 14, y: -8 });

    expect(card.style.getPropertyValue("translate")).toContain("calc(10px +");
    expect(card.style.getPropertyValue("translate")).toContain("calc(20px +");
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_X_PROP);
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_Y_PROP);
  });

  it("preserves stylesheet-authored transform longhands as additive bases", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;
    mockComputedStyle(card, {
      translate: "10px 20px",
      rotate: "8deg",
    });

    applyStudioPathOffset(card, { x: 14, y: -8 });
    applyStudioRotation(card, { angle: 12 });

    expect(card.style.getPropertyValue("translate")).toContain("calc(10px +");
    expect(card.style.getPropertyValue("translate")).toContain("calc(20px +");
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_X_PROP);
    expect(card.style.getPropertyValue("rotate")).toContain("8deg");
    expect(card.style.getPropertyValue("rotate")).toContain(STUDIO_ROTATION_PROP);
  });

  it("clears computed transform bases without freezing them inline", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;
    mockComputedStyle(card, {
      translate: "10px 20px",
      rotate: "8deg",
    });

    applyStudioPathOffset(card, { x: 14, y: -8 });
    applyStudioRotation(card, { angle: 12 });

    expect(
      applyStudioManualEditManifest(document, emptyStudioManualEditManifest(), "index.html"),
    ).toBe(0);

    expect(card.style.getPropertyValue("translate")).toBe("");
    expect(card.style.getPropertyValue("rotate")).toBe("");
  });

  it("does not compound stale studio variables as authored transform bases", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;

    card.style.setProperty(
      "translate",
      `var(${STUDIO_OFFSET_X_PROP}, 0px) var(${STUDIO_OFFSET_Y_PROP}, 0px)`,
    );
    card.style.setProperty("rotate", `var(${STUDIO_ROTATION_PROP}, 0deg)`);

    applyStudioPathOffset(card, { x: 14, y: -8 });
    applyStudioRotation(card, { angle: 12 });

    expect(card.style.getPropertyValue("translate")).toBe(
      `var(${STUDIO_OFFSET_X_PROP}, 0px) var(${STUDIO_OFFSET_Y_PROP}, 0px)`,
    );
    expect(card.style.getPropertyValue("rotate")).toBe(`var(${STUDIO_ROTATION_PROP}, 0deg)`);
  });

  it("applies box sizes through CSS dimensions and flex sizing overrides", () => {
    const document = createDocument(`
      <div style="display: flex; flex-direction: row">
        <div id="card" style="width: 160px; height: 90px"></div>
      </div>
    `);
    const card = document.getElementById("card") as HTMLElement;
    mockBoundingRect(card, 160, 90);

    applyStudioBoxSize(card, { width: 240, height: 135 });

    expect(readStudioBoxSize(card)).toEqual({ width: 240, height: 135 });
    expect(card.style.getPropertyValue(STUDIO_WIDTH_PROP)).toBe("240px");
    expect(card.style.getPropertyValue("width")).toBe("240px");
    expect(card.style.getPropertyValue("height")).toBe("135px");
    expect(card.style.getPropertyValue("flex-basis")).toBe("240px");
    expect(card.style.getPropertyValue("flex-grow")).toBe("0");
    expect(card.style.getPropertyValue("flex-shrink")).toBe("0");
    expect(card.style.getPropertyValue("box-sizing")).toBe("border-box");
    expect(card.style.getPropertyValue("scale")).toBe("");

    applyStudioBoxSizeDraft(card, { width: 260, height: 150 });
    expect(readStudioBoxSize(card)).toEqual({ width: 260, height: 150 });
    expect(card.style.getPropertyValue("width")).toBe("260px");
    expect(card.style.getPropertyValue("height")).toBe("150px");
    expect(card.style.getPropertyValue("flex-basis")).toBe("260px");

    const snapshot = captureStudioBoxSize(card);
    applyStudioBoxSizeDraft(card, { width: 280, height: 160 });
    restoreStudioBoxSize(card, snapshot);
    expect(readStudioBoxSize(card)).toEqual({ width: 260, height: 150 });
    expect(card.style.getPropertyValue("width")).toBe("260px");
    expect(card.style.getPropertyValue("height")).toBe("150px");
    expect(card.style.getPropertyValue("flex-basis")).toBe("260px");
  });

  it("applies rotations through CSS rotate longhand around the element center", () => {
    const document = createDocument(
      `<div id="card" style="rotate: 8deg; transform-origin: left top"></div>`,
    );
    const card = document.getElementById("card") as HTMLElement;

    applyStudioRotation(card, { angle: 24.24 });

    expect(readStudioRotation(card)).toEqual({ angle: 24.2 });
    expect(card.style.getPropertyValue(STUDIO_ROTATION_PROP)).toBe("24.2deg");
    expect(card.style.getPropertyValue("rotate")).toContain("8deg");
    expect(card.style.getPropertyValue("rotate")).toContain(STUDIO_ROTATION_PROP);
    expect(card.style.getPropertyValue("transform-origin")).toBe("center center");

    applyStudioRotationDraft(card, { angle: -12.26 });
    expect(readStudioRotation(card)).toEqual({ angle: -12.3 });
    expect(card.style.getPropertyValue("rotate")).toBe("calc(8deg + -12.3deg)");
    expect(card.style.getPropertyValue("transform-origin")).toBe("center center");

    const snapshot = captureStudioRotation(card);
    applyStudioRotationDraft(card, { angle: 45 });
    restoreStudioRotation(card, snapshot);
    expect(readStudioRotation(card)).toEqual({ angle: -12.3 });
    expect(card.style.getPropertyValue("rotate")).toBe("calc(8deg + -12.3deg)");
    expect(card.style.getPropertyValue("transform-origin")).toBe("center center");
  });

  it("does not recapture a studio rotation draft as the authored base", () => {
    const document = createDocument(`<div id="card" style="rotate: 8deg"></div>`);
    const card = document.getElementById("card") as HTMLElement;
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "rotation",
          "target": { "sourceFile": "index.html", "selector": "#card", "id": "card" },
          "angle": 35
        }
      ]
    }`);

    applyStudioRotation(card, { angle: 12 });
    applyStudioRotationDraft(card, { angle: 35 });
    expect(card.style.getPropertyValue("rotate")).toBe("calc(8deg + 35deg)");

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);

    expect(card.style.getPropertyValue("rotate")).toBe(
      `calc(8deg + var(${STUDIO_ROTATION_PROP}, 0deg))`,
    );
  });

  it("does not treat a base-free studio rotation draft as authored rotation", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "rotation",
          "target": { "sourceFile": "index.html", "selector": "#card", "id": "card" },
          "angle": 35
        }
      ]
    }`);

    applyStudioRotation(card, { angle: 12 });
    applyStudioRotationDraft(card, { angle: 35 });
    expect(card.style.getPropertyValue("rotate")).toBe("35deg");

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);

    expect(card.style.getPropertyValue("rotate")).toBe(`var(${STUDIO_ROTATION_PROP}, 0deg)`);
  });

  it("uses height for flex-basis inside column flex containers", () => {
    const document = createDocument(`
      <div style="display: flex; flex-direction: column">
        <div id="card" style="width: 160px; height: 90px"></div>
      </div>
    `);
    const card = document.getElementById("card") as HTMLElement;

    applyStudioBoxSize(card, { width: 240, height: 135 });

    expect(card.style.getPropertyValue("width")).toBe("240px");
    expect(card.style.getPropertyValue("height")).toBe("135px");
    expect(card.style.getPropertyValue("flex-basis")).toBe("135px");
  });

  it("uses additive CSS translate without mutating GSAP tweens during path-offset moves", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;
    const getTweensOf = vi.fn();
    const getProperty = vi.fn();
    const set = vi.fn();
    const tickerTick = vi.fn();
    const tween = {
      vars: { x: 0, y: 10, startAt: { x: -240, y: -20 } },
      targets: () => [card],
      invalidate: vi.fn(),
      parent: {
        time: () => 1.25,
        totalTime: vi.fn(),
        invalidate: vi.fn(),
      },
      _startAt: {
        vars: { x: -240, y: -20 },
        invalidate: vi.fn(),
      },
    };

    (
      document.defaultView as unknown as {
        gsap: {
          getTweensOf: () => Array<typeof tween>;
          getProperty: (_target: Element, property: string) => unknown;
          set: (_target: Element, vars: Record<string, unknown>) => void;
          ticker: { tick: () => void };
        };
      }
    ).gsap = {
      getTweensOf,
      getProperty,
      set,
      ticker: { tick: tickerTick },
    };

    applyStudioPathOffset(card, { x: 30, y: -12 });

    expect(tween.vars).toMatchObject({
      x: 0,
      y: 10,
      startAt: { x: -240, y: -20 },
    });
    expect(tween._startAt.vars).toEqual({ x: -240, y: -20 });
    expect(readStudioPathOffset(card)).toEqual({ x: 30, y: -12 });
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_X_PROP);
    expect(getTweensOf).not.toHaveBeenCalled();
    expect(getProperty).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(tickerTick).not.toHaveBeenCalled();

    beginStudioManualEditGesture(card);
    applyStudioPathOffsetDraft(card, { x: 35, y: -6 });

    expect(readStudioPathOffset(card)).toEqual({ x: 35, y: -6 });
    expect(card.style.getPropertyValue("translate")).toBe("35px -6px");
    expect(tween.vars).toMatchObject({
      x: 0,
      y: 10,
      startAt: { x: -240, y: -20 },
    });
    expect(tween._startAt.vars).toEqual({ x: -240, y: -20 });
    expect(tickerTick).not.toHaveBeenCalled();

    applyStudioPathOffset(card, { x: 35, y: -6 });
    endStudioManualEditGesture(card);

    expect(tween.vars).toMatchObject({
      x: 0,
      y: 10,
      startAt: { x: -240, y: -20 },
    });
    expect(tween._startAt.vars).toEqual({ x: -240, y: -20 });
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_X_PROP);

    expect(
      applyStudioManualEditManifest(document, emptyStudioManualEditManifest(), "index.html"),
    ).toBe(0);
    expect(tween.vars).toMatchObject({
      x: 0,
      y: 10,
      startAt: { x: -240, y: -20 },
    });
    expect(tween._startAt.vars).toEqual({ x: -240, y: -20 });
    expect(card.style.getPropertyValue(STUDIO_OFFSET_X_PROP)).toBe("");
    expect(card.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)).toBe("");
    expect(card.style.getPropertyValue("translate")).toBe("");
  });

  it("applies manifest offsets to matching preview elements", () => {
    const document = createDocument(`<div id="card"></div>`);
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "path-offset",
          "target": { "sourceFile": "index.html", "selector": "#card", "id": "card" },
          "x": 32,
          "y": 18
        }
      ]
    }`);

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);
    expect(readStudioPathOffset(document.getElementById("card") as HTMLElement)).toEqual({
      x: 32,
      y: 18,
    });
  });

  it("resolves manifest targets within the matching source file", () => {
    const document = createDocument(`
      <div data-composition-id="root">
        <div id="card" class="tile"></div>
        <div data-composition-id="nested" data-composition-file="scenes/nested.html">
          <div id="card" class="tile"></div>
          <div class="tile"></div>
        </div>
      </div>
    `);
    const htmlElement = document.defaultView?.HTMLElement;
    if (!htmlElement) throw new Error("HTMLElement fixture missing");
    const cards = Array.from(document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement => element instanceof htmlElement && element.id === "card",
    );
    const rootCard = cards[0];
    const nestedCard = cards[1];
    const tiles = Array.from(document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        element instanceof htmlElement && element.classList.contains("tile"),
    );
    const nestedSecondTile = tiles[2];
    if (!rootCard || !nestedCard || !nestedSecondTile) {
      throw new Error("source-scoped fixture missing");
    }

    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "path-offset",
          "target": {
            "sourceFile": "scenes/nested.html",
            "selector": "#card",
            "id": "card"
          },
          "x": 48,
          "y": 16
        },
        {
          "kind": "box-size",
          "target": {
            "sourceFile": "scenes/nested.html",
            "selector": ".tile",
            "selectorIndex": 1
          },
          "width": 220,
          "height": 80
        }
      ]
    }`);

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(2);
    expect(readStudioPathOffset(rootCard)).toEqual({ x: 0, y: 0 });
    expect(readStudioPathOffset(nestedCard)).toEqual({ x: 48, y: 16 });
    expect(readStudioBoxSize(nestedSecondTile)).toEqual({ width: 220, height: 80 });
  });

  it("resolves manifest targets inside composition-file hosts without composition ids", () => {
    const document = createDocument(`
      <div data-composition-id="root">
        <div id="card"></div>
        <div data-composition-file="scenes/anonymous.html">
          <div id="card"></div>
        </div>
      </div>
    `);
    const htmlElement = document.defaultView?.HTMLElement;
    if (!htmlElement) throw new Error("HTMLElement fixture missing");
    const cards = Array.from(document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement => element instanceof htmlElement && element.id === "card",
    );
    const rootCard = cards[0];
    const nestedCard = cards[1];
    if (!rootCard || !nestedCard) {
      throw new Error("anonymous composition fixture missing");
    }

    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "path-offset",
          "target": {
            "sourceFile": "scenes/anonymous.html",
            "selector": "#card",
            "id": "card"
          },
          "x": 24,
          "y": 12
        }
      ]
    }`);

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);
    expect(readStudioPathOffset(rootCard)).toEqual({ x: 0, y: 0 });
    expect(readStudioPathOffset(nestedCard)).toEqual({ x: 24, y: 12 });
  });

  it("applies nested source edits while previewing a non-index parent composition", () => {
    const document = createDocument(`
      <div data-composition-id="parent">
        <div id="parent-card"></div>
        <div data-composition-file="scenes/child.html">
          <div id="child-card"></div>
        </div>
      </div>
    `);
    const parentCard = document.getElementById("parent-card") as HTMLElement;
    const childCard = document.getElementById("child-card") as HTMLElement;
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "path-offset",
          "target": {
            "sourceFile": "scenes/parent.html",
            "selector": "#parent-card",
            "id": "parent-card"
          },
          "x": 12,
          "y": 8
        },
        {
          "kind": "path-offset",
          "target": {
            "sourceFile": "scenes/child.html",
            "selector": "#child-card",
            "id": "child-card"
          },
          "x": 36,
          "y": 18
        }
      ]
    }`);

    expect(applyStudioManualEditManifest(document, manifest, "scenes/parent.html")).toBe(2);
    expect(readStudioPathOffset(parentCard)).toEqual({ x: 12, y: 8 });
    expect(readStudioPathOffset(childCard)).toEqual({ x: 36, y: 18 });
  });

  it("applies and clears manifest box sizes while restoring authored inline size", () => {
    const document = createDocument(`
      <div style="display: flex; flex-direction: row">
        <div id="card" style="width: 160px; height: 90px"></div>
      </div>
    `);
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "box-size",
          "target": { "sourceFile": "index.html", "selector": "#card", "id": "card" },
          "width": 320,
          "height": 180
        }
      ]
    }`);
    const card = document.getElementById("card") as HTMLElement;
    mockBoundingRect(card, 160, 90);

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);
    expect(readStudioBoxSize(card)).toEqual({ width: 320, height: 180 });
    expect(card.style.getPropertyValue("width")).toBe("320px");
    expect(card.style.getPropertyValue("height")).toBe("180px");
    expect(card.style.getPropertyValue("flex-basis")).toBe("320px");

    expect(
      applyStudioManualEditManifest(document, emptyStudioManualEditManifest(), "index.html"),
    ).toBe(0);
    expect(readStudioBoxSize(card)).toEqual({ width: 0, height: 0 });
    expect(card.style.getPropertyValue("width")).toBe("160px");
    expect(card.style.getPropertyValue("height")).toBe("90px");
    expect(card.style.getPropertyValue("flex-basis")).toBe("");
    expect(card.style.getPropertyValue("flex-grow")).toBe("");
    expect(card.style.getPropertyValue("flex-shrink")).toBe("");
    expect(card.style.getPropertyValue("scale")).toBe("");
  });

  it("applies and clears manifest rotations while restoring authored inline rotation", () => {
    const document = createDocument(
      `<div id="card" style="rotate: 8deg; transform-origin: left top"></div>`,
    );
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "rotation",
          "target": { "sourceFile": "index.html", "selector": "#card", "id": "card" },
          "angle": 37.5
        }
      ]
    }`);
    const card = document.getElementById("card") as HTMLElement;

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);
    expect(readStudioRotation(card)).toEqual({ angle: 37.5 });
    expect(card.style.getPropertyValue("rotate")).toContain(STUDIO_ROTATION_PROP);
    expect(card.style.getPropertyValue("rotate")).toContain("8deg");
    expect(card.style.getPropertyValue("transform-origin")).toBe("center center");

    expect(
      applyStudioManualEditManifest(document, emptyStudioManualEditManifest(), "index.html"),
    ).toBe(0);
    expect(readStudioRotation(card)).toEqual({ angle: 0 });
    expect(card.style.getPropertyValue("rotate")).toBe("8deg");
    expect(card.style.getPropertyValue("transform-origin")).toBe("left top");
  });

  it("clears stale preview offsets that are no longer in the manifest", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;

    applyStudioPathOffset(card, { x: 24, y: 12 });
    expect(readStudioPathOffset(card)).toEqual({ x: 24, y: 12 });

    expect(
      applyStudioManualEditManifest(document, emptyStudioManualEditManifest(), "index.html"),
    ).toBe(0);

    expect(readStudioPathOffset(card)).toEqual({ x: 0, y: 0 });
    expect(card.style.getPropertyValue(STUDIO_OFFSET_X_PROP)).toBe("");
    expect(card.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)).toBe("");
    expect(card.style.getPropertyValue("translate")).toBe("");
  });

  it("restores authored inline translate when clearing offsets", () => {
    const document = createDocument(`<div id="card" style="translate: 10px 20px"></div>`);
    const card = document.getElementById("card") as HTMLElement;

    applyStudioPathOffset(card, { x: 24, y: 12 });
    expect(card.style.getPropertyValue("translate")).toContain(STUDIO_OFFSET_X_PROP);

    expect(
      applyStudioManualEditManifest(document, emptyStudioManualEditManifest(), "index.html"),
    ).toBe(0);

    expect(card.style.getPropertyValue("translate")).toBe("10px 20px");
  });

  it("does not replay the manifest over an active manual edit gesture", () => {
    const document = createDocument(`<div id="card"></div>`);
    const card = document.getElementById("card") as HTMLElement;
    const manifest = parseStudioManualEditManifest(`{
      "version": 1,
      "edits": [
        {
          "kind": "path-offset",
          "target": { "sourceFile": "index.html", "selector": "#card", "id": "card" },
          "x": 8,
          "y": 4
        }
      ]
    }`);

    applyStudioPathOffset(card, { x: 40, y: 24 });
    const firstToken = beginStudioManualEditGesture(card);
    const secondToken = beginStudioManualEditGesture(card);
    endStudioManualEditGesture(card, firstToken);

    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(0);
    expect(readStudioPathOffset(card)).toEqual({ x: 40, y: 24 });

    endStudioManualEditGesture(card, secondToken);
    expect(applyStudioManualEditManifest(document, manifest, "index.html")).toBe(1);
    expect(readStudioPathOffset(card)).toEqual({ x: 8, y: 4 });
  });

  it("reapplies the latest preview manifest after wrapped seeks", () => {
    const window = new Window();
    const seekArgs: unknown[][] = [];
    const previewWindow = window as unknown as Parameters<
      typeof installStudioManualEditSeekReapply
    >[0] & {
      __player: Record<string, unknown>;
    };
    previewWindow.__player = {
      seek: (...args: unknown[]) => {
        seekArgs.push(args);
      },
    };

    let applied = 0;
    expect(
      installStudioManualEditSeekReapply(previewWindow, () => {
        applied += 1;
      }),
    ).toBe(true);
    (previewWindow.__player.seek as (time: number, suppressEvents: boolean) => void)(1, false);
    expect(applied).toBe(1);
    expect(seekArgs).toEqual([[1, false]]);

    expect(
      installStudioManualEditSeekReapply(previewWindow, () => {
        applied += 10;
      }),
    ).toBe(true);
    (previewWindow.__player.seek as (time: number) => void)(2);
    expect(applied).toBe(11);
  });

  it("reapplies manual edits while fresh playback is active", () => {
    const window = new Window();
    const frames: FrameRequestCallback[] = [];
    let playing = false;
    const previewWindow = window as unknown as Parameters<
      typeof installStudioManualEditSeekReapply
    >[0] & {
      __player: Record<string, unknown>;
      requestAnimationFrame: (callback: FrameRequestCallback) => number;
    };
    previewWindow.requestAnimationFrame = (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    };
    previewWindow.__player = {
      play: () => {
        playing = true;
      },
      isPlaying: () => playing,
    };

    let applied = 0;
    expect(
      installStudioManualEditSeekReapply(previewWindow, () => {
        applied += 1;
      }),
    ).toBe(true);

    (previewWindow.__player.play as () => void)();
    expect(applied).toBe(1);
    expect(frames).toHaveLength(1);

    frames.shift()?.(16);
    expect(applied).toBe(2);
    expect(frames).toHaveLength(1);

    playing = false;
    frames.shift()?.(32);
    expect(applied).toBe(3);
    expect(frames).toHaveLength(0);
  });

  it("stops playback reapply after an unpaused timeline has completed", () => {
    const window = new Window();
    const frames: FrameRequestCallback[] = [];
    let currentTime = 0;
    let paused = true;
    const previewWindow = window as unknown as Parameters<
      typeof installStudioManualEditSeekReapply
    >[0] & {
      __timeline: Record<string, unknown>;
      requestAnimationFrame: (callback: FrameRequestCallback) => number;
    };
    previewWindow.requestAnimationFrame = (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    };
    previewWindow.__timeline = {
      play: () => {
        paused = false;
      },
      paused: () => paused,
      isActive: () => false,
      time: () => currentTime,
      duration: () => 2,
    };

    let applied = 0;
    expect(
      installStudioManualEditSeekReapply(previewWindow, () => {
        applied += 1;
      }),
    ).toBe(true);

    (previewWindow.__timeline.play as () => void)();
    expect(applied).toBe(1);
    expect(frames).toHaveLength(1);

    currentTime = 2;
    frames.shift()?.(16);
    expect(applied).toBe(2);
    expect(frames).toHaveLength(0);
  });
});

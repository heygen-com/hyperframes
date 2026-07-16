// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { COLOR_GRADING_AUTHORED_OPACITY_ATTR } from "@hyperframes/core/color-grading";
import type { DomEditSelection } from "../components/editor/domEditing";
import { runDomStyleSelectionCommit } from "./domStyleCommit";

function makeSelection(element: HTMLElement): DomEditSelection {
  return {
    element,
    id: element.id,
    selector: `#${element.id}`,
    sourceFile: "index.html",
    compositionPath: "index.html",
    label: "Target",
    tagName: "div",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: {},
    inlineStyles: { opacity: element.style.opacity },
    computedStyles: { opacity: element.style.opacity },
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

async function resetOpacity(
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): Promise<DomEditSelection> {
  const selection = makeSelection(element);
  await runDomStyleSelectionCommit({
    selection,
    property: "opacity",
    value: null,
    activeCompPath: "index.html",
    doc: iframe.contentDocument,
    commitVersions: new Map(),
    persistDomEditOperations: vi.fn(async () => undefined),
    refreshDomEditSelectionFromPreview: vi.fn(),
    resolveImportedFontAsset: () => null,
    showToast: vi.fn(),
  });
  return selection;
}

describe("runDomStyleSelectionCommit opacity reset", () => {
  it("restores a stamped authored opacity instead of removing the runtime hide", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    const element = doc.createElement("div");
    element.id = "target";
    element.setAttribute(COLOR_GRADING_AUTHORED_OPACITY_ATTR, "0.65");
    element.style.setProperty("opacity", "0", "important");
    doc.body.append(element);

    const selection = await resetOpacity(iframe, element);

    expect(element.style.getPropertyValue("opacity")).toBe("0.65");
    expect(element.style.getPropertyPriority("opacity")).toBe("");
    expect(selection.computedStyles.opacity).toBe("0.65");
    iframe.remove();
  });

  it("removes opacity when the authored stamp records no inline value", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    const element = doc.createElement("div");
    element.id = "target";
    element.setAttribute(COLOR_GRADING_AUTHORED_OPACITY_ATTR, "");
    element.style.setProperty("opacity", "0", "important");
    doc.body.append(element);

    const selection = await resetOpacity(iframe, element);

    expect(element.style.getPropertyValue("opacity")).toBe("");
    expect(Object.hasOwn(selection.computedStyles, "opacity")).toBe(false);
    iframe.remove();
  });

  it("keeps the ungraded reset behavior", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    const style = doc.createElement("style");
    style.textContent = "#target { opacity: 0.25; }";
    doc.head.append(style);
    const element = doc.createElement("div");
    element.id = "target";
    element.style.opacity = "0.8";
    doc.body.append(element);

    const selection = await resetOpacity(iframe, element);

    expect(element.style.getPropertyValue("opacity")).toBe("");
    expect(selection.computedStyles.opacity).toBe("0.25");
    iframe.remove();
  });
});

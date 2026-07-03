// Shared harness helpers for selection hook tests (useDomSelection,
// usePreviewInteraction). Test-only module.
import type { DomEditSelection } from "../components/editor/domEditing";

export function installReactActEnvironment(): void {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });
}

export function makeSelection(label: string, element: HTMLElement): DomEditSelection {
  return {
    element,
    id: element.id || undefined,
    selector: `#${element.id || label}`,
    selectorIndex: 0,
    sourceFile: "index.html",
    compositionPath: "index.html",
    label,
    tagName: element.tagName.toLowerCase(),
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: false,
    },
  };
}

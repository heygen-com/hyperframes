/**
 * Shared fixtures for the WebMCP tool tests.
 *
 * Not a `.test` file so vitest does not collect it as a suite. Mirrors the
 * existing `hooks/domSelectionTestHarness.ts` convention.
 */

import { expect } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { ToolFailure, ToolResult } from "./toolResult";

/**
 * An element inside a real iframe, which is where Studio's chrome expects to
 * find preview elements. The separate realm matters: a preview element is not
 * an instance of Studio's own `HTMLElement`.
 */
export function previewDoc(html: string): Document {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("expected iframe document");
  doc.body.innerHTML = html;
  return doc;
}

export function previewElement(html: string, id: string): HTMLElement {
  const doc = previewDoc(html);
  const element = doc.getElementById(id);
  const HTMLElementCtor = doc.defaultView?.HTMLElement;
  if (!HTMLElementCtor || !(element instanceof HTMLElementCtor)) {
    throw new Error(`expected preview element #${id}`);
  }
  return element;
}

export function selectionFor(
  element: HTMLElement,
  overrides: Partial<DomEditSelection> = {},
): DomEditSelection {
  return {
    id: element.id || undefined,
    hfId: element.getAttribute("data-hf-id") ?? undefined,
    element,
    label: "Headline",
    tagName: element.tagName.toLowerCase(),
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 40, y: 12, width: 880, height: 96 },
    textContent: element.textContent,
    dataAttributes: { "data-role": "title" },
    inlineStyles: { color: "red" },
    computedStyles: { "font-size": "42.7px", color: "rgb(255, 0, 0)" },
    textFields: [
      {
        key: "self",
        label: "Text",
        value: element.textContent ?? "",
        tagName: element.tagName.toLowerCase(),
        attributes: [],
        inlineStyles: {},
        computedStyles: {},
        source: "self",
      },
    ],
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
    ...overrides,
  };
}

export function expectOk<T>(result: ToolResult<T>): { ok: true } & T {
  expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

export function expectFailure(result: ToolResult<unknown>): ToolFailure {
  expect(result.ok, `expected failure, got ${JSON.stringify(result)}`).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result;
}

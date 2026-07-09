// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropertyPanelProps } from "./propertyPanelHelpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// PropertyPanel calls useStudioShellContext() unconditionally; supply the one
// field it reads (showToast) so the component can mount without the full shell.
vi.mock("../../contexts/StudioContext", async () => {
  const actual = await vi.importActual<typeof import("../../contexts/StudioContext")>(
    "../../contexts/StudioContext",
  );
  return { ...actual, useStudioShellContext: () => ({ showToast: vi.fn() }) };
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.doUnmock("./manualEditingAvailability");
  vi.resetModules();
});

function baseElement() {
  return {
    element: document.createElement("div"),
    id: "mono-label",
    selector: ".mono-label",
    label: "Mono Label",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: -24, width: 257, height: 29 },
    textContent: "PACKETS / FRAME",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [
      {
        key: "field-0",
        label: "Text",
        value: "PACKETS / FRAME",
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
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

// Bug 1 fixture: no text fields at all, so isTextEditableSelection(element) is
// false — the Text FlatGroup must not render (not even empty/collapsed).
function nonTextElement() {
  return {
    ...baseElement(),
    id: "image-clip",
    selector: "#image-clip",
    label: "Image Clip",
    tagName: "img",
    textContent: "",
    textFields: [],
  };
}

// Bug 2 fixture: 2+ text fields, which routes FlatTextSection to the legacy
// multi-field <TextSection> fallback — must not double-render the "Text"
// heading (FlatGroup's own heading + TextSection's internal Section heading).
function multiFieldTextElement() {
  const base = baseElement();
  return {
    ...base,
    textFields: [
      base.textFields[0],
      {
        key: "field-1",
        label: "Text",
        value: "SECOND FIELD",
        tagName: "div",
        attributes: [],
        inlineStyles: {},
        computedStyles: {},
        source: "self",
      },
    ],
  };
}

async function renderPanel(
  flatEnabled: boolean,
  elementOverride: ReturnType<typeof baseElement> = baseElement(),
) {
  vi.resetModules();
  vi.doMock("./manualEditingAvailability", async () => {
    const actual = await vi.importActual<typeof import("./manualEditingAvailability")>(
      "./manualEditingAvailability",
    );
    return { ...actual, STUDIO_FLAT_INSPECTOR_ENABLED: flatEnabled };
  });
  const { PropertyPanel } = await import("./PropertyPanel");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // Only the props the render path touches are supplied; the rest are unused at
  // mount (handlers fire on interaction), so cast a minimal object to the full
  // props shape rather than stubbing all ~15 required fields.
  const props = {
    element: elementOverride,
    assets: [],
    onSetStyle: vi.fn(),
    onSetText: vi.fn(),
    onSetAttributeLive: vi.fn(),
  } as unknown as PropertyPanelProps;
  act(() => {
    root.render(<PropertyPanel {...props} />);
  });
  return { host, root };
}

// renderPanel resetModules()+dynamic-imports PropertyPanel (needed for a fresh
// flag read); transforming the full section graph uncached can exceed the 5s
// default under heavy parallel full-suite load, so give these a wider margin.
const RENDER_TIMEOUT_MS = 20_000;

describe("PropertyPanel — STUDIO_FLAT_INSPECTOR_ENABLED off", () => {
  it(
    "renders the legacy header, not the flat header",
    async () => {
      const { host, root } = await renderPanel(false);
      expect(host.querySelector('[data-flat-header-icon="true"]')).toBeNull();
      expect(host.textContent).toContain("Mono Label");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );
});

describe("PropertyPanel — STUDIO_FLAT_INSPECTOR_ENABLED on", () => {
  it(
    "renders the flat header, the Text group open by default, and the flat footer",
    async () => {
      const { host, root } = await renderPanel(true);
      expect(host.querySelector('[data-flat-header-icon="true"]')).not.toBeNull();
      expect(host.querySelector('[data-flat-group-open="true"]')).not.toBeNull();
      expect(host.textContent).toContain("Ask agent about this element");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "collapses the Text group on caret click and can reopen it",
    async () => {
      const { host, root } = await renderPanel(true);
      const collapseButton = host.querySelector<HTMLButtonElement>(
        '[data-flat-group-open="true"] button[title="Collapse"]',
      );
      act(() => collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(host.querySelector('[data-flat-group-open="true"]')).toBeNull();
      const collapsedRow = host.querySelector<HTMLButtonElement>(
        '[data-flat-group-collapsed="true"]',
      );
      expect(collapsedRow).not.toBeNull();
      act(() => collapsedRow?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(host.querySelector('[data-flat-group-open="true"]')).not.toBeNull();
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "renders no Text group at all for a non-text element (bug 1)",
    async () => {
      const { host, root } = await renderPanel(true, nonTextElement());
      expect(host.querySelector('[data-flat-group-open="true"]')).toBeNull();
      expect(host.querySelector('[data-flat-group-collapsed="true"]')).toBeNull();
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "renders exactly one Text heading for a multi-field text element (bug 2)",
    async () => {
      const { host, root } = await renderPanel(true, multiFieldTextElement());
      // The FlatGroup's own "Text" heading is the only one that should exist —
      // the legacy TextSection's internal Section heading (data-panel-section
      // ="text") must be suppressed when it's used as the flat fallback.
      expect(host.querySelector('[data-flat-group-open="true"]')).not.toBeNull();
      expect(host.querySelector('[data-panel-section="text"]')).toBeNull();
      // Content from the legacy multi-field fallback must still render.
      expect(host.textContent).toContain("Text layers");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );
});

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

// Style-only fixture: no text fields (Text group must not render), but
// canEditStyles stays true (inherited from baseElement()) so the Style group
// is gated in.
function styleOnlyElement() {
  return {
    ...baseElement(),
    id: "stat-card",
    selector: ".stat-card",
    label: "Stat Card",
    textFields: [],
    inlineStyles: { "background-color": "#0D0C09" },
  };
}

// Flex fixture (Plan 3a Task 5): display:flex drives BOTH the legacy
// StyleSections Flex `Section` AND the new flat Layout group's
// LayoutFlexBlock. Used to prove Flex renders exactly once on the flat path.
// styles are read from computedStyles (PropertyPanel line ~113), so set it
// there.
function flexElement() {
  return {
    ...baseElement(),
    id: "flex-row",
    selector: ".flex-row",
    label: "Flex Row",
    textFields: [],
    computedStyles: { display: "flex" },
  };
}

// Motion fixture (Plan 3b Task 4): an authored clip range (data-start present)
// makes resolveEditingSections turn on `sections.timing`, so the Motion group
// renders via its Timing gate even with no GSAP edit handlers wired.
function animatedElement() {
  return {
    ...baseElement(),
    id: "anim-clip",
    selector: ".anim-clip",
    label: "Anim Clip",
    dataAttributes: { start: "0", duration: "4" },
  };
}

// Inferred-timing fixture (whole-plan coherence fix): NO explicit data-start
// or data-duration — sections.timing must turn on via animationCount (fed
// from gsapAnimations.length), not an authored attribute, so both the Motion
// Timing row and the Layout keyframe gutter are forced to infer the range
// from the element's own GSAP tween instead of reading it off an attribute.
function inferredMotionElement() {
  return {
    ...baseElement(),
    id: "inferred-anim",
    selector: "#inferred-anim",
    label: "Inferred Anim",
  };
}

// A single "to" tween running from t=2 to t=5 (position 2, duration 3), with
// keyframes on "x" at 0/50/100% — enough to drive both FlatTimingRow's
// inference and the Layout "x" row's keyframe-seek gutter.
const INFERRED_TIMING_ANIMATION = {
  id: "a1",
  targetSelector: "#inferred-anim",
  method: "to",
  position: 2,
  duration: 3,
  properties: { x: 100 },
  keyframes: {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 50, properties: { x: 50 } },
      { percentage: 100, properties: { x: 100 } },
    ],
  },
} as never;

async function renderPanel(
  flatEnabled: boolean,
  elementOverride: ReturnType<typeof baseElement> = baseElement(),
  propsOverride: Partial<PropertyPanelProps> = {},
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
    ...propsOverride,
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

// Find the collapsed accordion row whose title matches and click it open.
function openFlatGroup(host: HTMLElement, title: string) {
  const row = Array.from(host.querySelectorAll('[data-flat-group-collapsed="true"]')).find((el) =>
    el.textContent?.includes(title),
  );
  if (!row) throw new Error(`expected a collapsed ${title} row`);
  act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

const openGroupText = (host: HTMLElement) =>
  host.querySelector('[data-flat-group-open="true"]')?.textContent ?? "";

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
      // nonTextElement() inherits canEditStyles: true from baseElement(), so
      // the Style group (Task 10) renders and opens by default here — the
      // invariant under test is narrower than "no flat group at all": no
      // group titled "Text" may appear, open or collapsed.
      const { host, root } = await renderPanel(true, nonTextElement());
      const openTitle = host.querySelector(
        '[data-flat-group-open="true"] .text-panel-text-0',
      )?.textContent;
      const collapsedTitles = Array.from(
        host.querySelectorAll('[data-flat-group-collapsed="true"] .text-panel-text-2'),
      ).map((el) => el.textContent);
      expect(openTitle).not.toBe("Text");
      expect(collapsedTitles).not.toContain("Text");
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

describe("PropertyPanel — Style group (flag on)", () => {
  it(
    "renders the Style group for a style-editable, non-text element",
    async () => {
      const { host, root } = await renderPanel(true, styleOnlyElement());
      expect(host.textContent).toContain("Style");
      expect(host.textContent).toContain("Fill");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "one-open accordion: opening Style closes Text",
    async () => {
      // baseElement() is text-editable and has capabilities.canEditStyles:
      // true, so both the Text and Style groups render for it.
      const { host, root } = await renderPanel(true);
      const textGroup = () => host.querySelector('[data-flat-group-open="true"]');
      expect(textGroup()?.textContent).toContain("Text");
      const styleCollapsedRow = Array.from(
        host.querySelectorAll('[data-flat-group-collapsed="true"]'),
      ).find((el) => el.textContent?.includes("Style"));
      if (!styleCollapsedRow) throw new Error("expected a collapsed Style row");
      act(() => styleCollapsedRow.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(textGroup()?.textContent).not.toContain("Text");
      expect(host.querySelector('[data-flat-group-open="true"]')?.textContent).toContain("Style");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );
});

describe("PropertyPanel — Layout group (Plan 3a)", () => {
  it(
    "always renders the Layout group, and opening it closes whichever other group was open",
    async () => {
      const { host, root } = await renderPanel(true);
      // Text group is open by default for the base text-editable fixture.
      expect(host.querySelector('[data-flat-group-open="true"]')?.textContent).toContain("Text");

      const layoutCollapsedRow = Array.from(
        host.querySelectorAll('[data-flat-group-collapsed="true"]'),
      ).find((el) => el.textContent?.includes("Layout"));
      if (!layoutCollapsedRow) throw new Error("expected a collapsed Layout row");
      act(() => layoutCollapsedRow.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      const openGroup = host.querySelector('[data-flat-group-open="true"]');
      expect(openGroup?.textContent).toContain("Layout");
      expect(openGroup?.textContent).toContain("X");
      expect(openGroup?.textContent).not.toContain("Ask agent"); // sanity: not matching the footer
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "renders Flex exactly once on the flat path (flat Layout only, legacy suppressed)",
    async () => {
      const { host, root } = await renderPanel(true, flexElement());
      const layoutCollapsedRow = Array.from(
        host.querySelectorAll('[data-flat-group-collapsed="true"]'),
      ).find((el) => el.textContent?.includes("Layout"));
      if (!layoutCollapsedRow) throw new Error("expected a collapsed Layout row");
      act(() => layoutCollapsedRow.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      // The legacy StyleSections Flex `Section` (data-panel-section="flex") must
      // NOT render on the flat path — the only two Flex renderers are the legacy
      // Section and the flat LayoutFlexBlock, so its absence + the flat block's
      // presence proves Flex renders exactly once (not twice, not zero).
      expect(host.querySelector('[data-panel-section="flex"]')).toBeNull();
      const openGroup = host.querySelector('[data-flat-group-open="true"]');
      expect(openGroup?.textContent).toContain("Layout");
      expect(openGroup?.textContent).toContain("Flex");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );
});

describe("PropertyPanel — Motion group (Plan 3b)", () => {
  it(
    "renders the Motion group with Timing, and opening it closes the previously open group (4-way exclusivity)",
    async () => {
      const { host, root } = await renderPanel(true, animatedElement());
      // Text is open by default for the text-editable fixture.
      expect(openGroupText(host)).toContain("Text");

      openFlatGroup(host, "Motion");
      const openGroup = openGroupText(host);
      expect(openGroup).toContain("Motion");
      // FlatTimingRow (Start/End/Duration) renders inside the Motion group.
      expect(openGroup).toContain("Start");
      expect(openGroup).toContain("Duration");
      // One-open accordion: opening Motion closed the Text group.
      expect(openGroup).not.toContain("Text");

      // Reverse direction: opening Layout closes Motion.
      openFlatGroup(host, "Layout");
      const openAfter = openGroupText(host);
      expect(openAfter).toContain("Layout");
      expect(openAfter).not.toContain("Motion");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "hides the effect list (showEffects off) when the GSAP edit handlers are absent",
    async () => {
      // STUDIO_GSAP_PANEL_ENABLED defaults on, but none of the five required
      // edit handlers are supplied here, so the effect-list half of the
      // double-gate stays closed — only the Timing row shows.
      const { host, root } = await renderPanel(true, animatedElement());
      openFlatGroup(host, "Motion");
      const openGroup = openGroupText(host);
      expect(openGroup).toContain("Motion");
      expect(openGroup).toContain("Duration"); // Timing still shows
      expect(openGroup).not.toContain("Add effect"); // effects gated off
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "shows the effect list (showEffects on) when the flag and all five handlers are present",
    async () => {
      const { host, root } = await renderPanel(true, animatedElement(), {
        onUpdateGsapProperty: vi.fn(),
        onUpdateGsapMeta: vi.fn(),
        onDeleteGsapAnimation: vi.fn(),
        onAddGsapProperty: vi.fn(),
        onAddGsapAnimation: vi.fn(),
      });
      openFlatGroup(host, "Motion");
      expect(openGroupText(host)).toContain("Add effect");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );
});

// Whole-plan coherence fix: Layout's keyframe-seek basis and Motion's Timing
// row basis must agree on the same start/duration for an element that has
// animations but no explicit data-duration — before the fix, Layout fell back
// to a naive `duration ?? 1` while Motion correctly inferred the range from
// the tween (position 2, duration 3 -> start 2 / duration 3 / end 5).
describe("PropertyPanel — flat Layout/Motion timing agreement (whole-plan coherence fix)", () => {
  it(
    "Motion's Timing row shows the inferred start/end/duration for an element with animations but no explicit duration",
    async () => {
      const { host, root } = await renderPanel(true, inferredMotionElement(), {
        gsapAnimations: [INFERRED_TIMING_ANIMATION],
      });
      openFlatGroup(host, "Motion");
      const motionGroup = host.querySelector('[data-flat-group-open="true"]');
      if (!motionGroup) throw new Error("expected the Motion group to be open");
      expect(motionGroup.textContent).toContain("Inferred");
      const inputs = motionGroup.querySelectorAll<HTMLInputElement>("input");
      // FlatTimingRow renders Start, End, Duration in that order.
      expect(inputs[0]?.value).toBe("2.00s");
      expect(inputs[1]?.value).toBe("5.00s");
      expect(inputs[2]?.value).toBe("3.00s");
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "Layout's X-row keyframe gutter seeks to the SAME absolute time Motion's Timing row shows as the midpoint (50% of an inferred 2s-5s range = 3.5s)",
    async () => {
      const onSeekToTime = vi.fn();
      const { host, root } = await renderPanel(true, inferredMotionElement(), {
        gsapAnimations: [INFERRED_TIMING_ANIMATION],
        onSeekToTime,
      });
      openFlatGroup(host, "Layout");
      const layoutGroup = host.querySelector('[data-flat-group-open="true"]');
      if (!layoutGroup) throw new Error("expected the Layout group to be open");

      const xRow = Array.from(layoutGroup.querySelectorAll<HTMLElement>(".group")).find(
        (el) => el.querySelector("span")?.textContent === "X",
      );
      if (!xRow) throw new Error("expected an X row");
      const gutter = xRow.querySelector('[data-flat-kf-gutter="true"]');
      if (!gutter) throw new Error("expected a keyframe gutter on the X row");
      // The diamond button always carries a `title`; the two plain arrow
      // buttons don't. At currentPct=0 with keyframes at 0/50/100%, the prev
      // arrow is disabled (no earlier keyframe) and the next arrow seeks to
      // the 50% keyframe — exactly the case the coherence bug affected.
      const nextArrow = Array.from(gutter.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => !b.title && !b.disabled,
      );
      if (!nextArrow) throw new Error("expected an enabled next-keyframe arrow button");
      act(() => nextArrow.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      // Same basis as the Timing row: start 2 + 50% * duration 3 = 3.5.
      expect(onSeekToTime).toHaveBeenCalledWith(3.5);
      act(() => root.unmount());
    },
    RENDER_TIMEOUT_MS,
  );
});

// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropertyPanelProps } from "./propertyPanelHelpers";
import { PropertyPanel } from "./PropertyPanel";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../contexts/StudioContext", async () => {
  const actual = await vi.importActual<typeof import("../../contexts/StudioContext")>(
    "../../contexts/StudioContext",
  );
  return { ...actual, useStudioShellContext: () => ({ showToast: vi.fn() }) };
});
vi.mock("./manualEditingAvailability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manualEditingAvailability")>()),
  STUDIO_FLAT_INSPECTOR_ENABLED: true,
}));

function videoElement(): NonNullable<PropertyPanelProps["element"]> {
  return {
    element: document.createElement("video"),
    id: "clip",
    selector: "#clip",
    label: "Clip",
    tagName: "video",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 640, height: 360 },
    textContent: "",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
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

async function renderPanel(
  element: NonNullable<PropertyPanelProps["element"]>,
  propsOverride: Partial<PropertyPanelProps>,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props = {
    element,
    assets: [],
    onSetStyle: vi.fn(),
    onSetText: vi.fn(),
    onSetAttributeLive: vi.fn(),
    ...propsOverride,
  } as unknown as PropertyPanelProps;
  act(() => {
    root.render(
      <TimelineEditProvider value={{}}>
        <PropertyPanel {...props} />
      </TimelineEditProvider>,
    );
  });
  return { host, root };
}

function openFlatGroup(host: HTMLElement, title: string) {
  const row = Array.from(host.querySelectorAll('[data-flat-group-collapsed="true"]')).find((el) =>
    el.textContent?.includes(title),
  );
  if (!row) throw new Error(`expected a collapsed ${title} row`);
  act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("PropertyPanel — saving a grade", () => {
  afterEach(() => vi.useRealTimers());

  it("saves a 30-tick Exposure drag to the file once, through the saving setter", async () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn();
    const onSetAttributeQuiet = vi.fn();
    const { host, root } = await renderPanel(videoElement(), {
      onSetAttributeLive,
      onSetAttributeQuiet,
    });
    openFlatGroup(host, "Grade");
    const track = host.querySelector<HTMLElement>('[role="slider"][aria-label="Exposure"]');
    if (!track) throw new Error("expected the Exposure slider");
    track.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 20 }) as DOMRect;
    let captured = false;
    track.setPointerCapture = () => void (captured = true);
    track.hasPointerCapture = () => captured;
    track.releasePointerCapture = () => void (captured = false);
    const pointer = (type: string, clientX: number) =>
      act(() => {
        track.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }));
      });

    pointer("pointerdown", 200);
    for (let tick = 1; tick <= 30; tick++) {
      act(() => vi.advanceTimersByTime(16));
      pointer("pointermove", 200 + tick * 5);
    }
    pointer("pointerup", 350);
    act(() => vi.advanceTimersByTime(1000));

    const saves = onSetAttributeQuiet.mock.calls.filter(([attr]) => attr === "color-grading");
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0]![1] as string)).toMatchObject({ adjust: { exposure: 1.5 } });
    act(() => root.unmount());
  });
});

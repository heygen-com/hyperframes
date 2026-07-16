// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
import { PropertyPanel3dTransform } from "./propertyPanel3dTransform";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function createSelection(): DomEditSelection {
  const composition = document.createElement("div");
  composition.dataset.compositionId = "main";
  Object.defineProperty(composition, "offsetHeight", { value: 720 });
  const element = document.createElement("div");
  composition.append(element);
  document.body.append(composition);

  return {
    element,
    id: "card",
    selector: "#card",
    sourceFile: "index.html",
    compositionPath: "index.html",
    label: "Card",
    tagName: "div",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
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

describe("PropertyPanel3dTransform depth control", () => {
  function renderDepthControl(gsapRuntimeValues: Record<string, number>) {
    vi.useFakeTimers();
    const previews: Array<Record<string, number>> = [];
    const commits: Array<Record<string, number | string>> = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <PropertyPanel3dTransform
          gsapRuntimeValues={gsapRuntimeValues}
          gsapAnimId={null}
          gsapKeyframes={null}
          currentPct={0}
          elStart={0}
          elDuration={1}
          element={createSelection()}
          onCommitAnimatedProperties={async (_element, props) => {
            commits.push(props);
          }}
          onLivePreviewProps={(_element, props) => {
            previews.push(props);
          }}
        />,
      );
    });

    const cube = host.querySelector<SVGSVGElement>('svg[role="slider"]');
    if (!cube) throw new Error("Missing 3D transform cube");

    act(() => {
      cube.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, cancelable: true }));
    });
    act(() => vi.advanceTimersByTime(160));

    return {
      previews,
      commits,
      cleanup: () => act(() => root.unmount()),
    };
  }

  it("initializes perspective when a fresh element is moved in depth", () => {
    const result = renderDepthControl({ rotationZ: 0, z: 0 });

    expect(result.previews).toEqual([{ z: 100, transformPerspective: 720 }]);
    expect(result.commits).toEqual([{ z: 100, transformPerspective: 720 }]);
    expect(result.previews[0]).not.toHaveProperty("rotationX");
    expect(result.previews[0]).not.toHaveProperty("rotationY");
    expect(result.commits[0]).not.toHaveProperty("rotationX");
    expect(result.commits[0]).not.toHaveProperty("rotationY");
    result.cleanup();
  });

  it("commits only z when the element already has perspective", () => {
    const result = renderDepthControl({
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      transformPerspective: 900,
      z: 0,
    });

    expect(result.previews).toEqual([{ z: 100 }]);
    expect(result.commits).toEqual([{ z: 100 }]);
    result.cleanup();
  });
});

// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LayoutFlexBlock,
  LayoutGeometryRows,
  LayoutZIndexRow,
} from "./propertyPanelFlatLayoutSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

function getFlatRowInput(host: HTMLElement, label: string): HTMLInputElement {
  const rows = Array.from(host.querySelectorAll<HTMLElement>(".group"));
  const row = rows.find((el) => el.querySelector("span")?.textContent === label);
  const input = row?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`expected an input for row "${label}"`);
  return input;
}

function baseGeometryProps(overrides: Partial<Parameters<typeof LayoutGeometryRows>[0]> = {}) {
  return {
    displayX: 0,
    displayY: -24,
    displayW: 257.4,
    displayH: 29,
    displayR: 0,
    manualOffsetEditingDisabled: false,
    manualSizeEditingDisabled: false,
    manualRotationEditingDisabled: false,
    commitManualOffset: vi.fn(),
    commitManualSize: vi.fn(),
    commitManualRotation: vi.fn(),
    gsapAnimId: null,
    navKeyframes: null,
    currentPct: 0,
    seekFromKfPct: vi.fn(),
    animIdForProp: (prop: string) => prop,
    onCommitAnimatedProperty: vi.fn(),
    onRemoveKeyframe: vi.fn(),
    onConvertToKeyframes: vi.fn(),
    ...overrides,
  };
}

describe("LayoutGeometryRows", () => {
  it("renders X, Y, W, H, Angle labels and formatted values", () => {
    const { host, root } = renderInto(<LayoutGeometryRows {...baseGeometryProps()} />);
    expect(host.textContent).toContain("X");
    expect(host.textContent).toContain("Y");
    expect(host.textContent).toContain("W");
    expect(host.textContent).toContain("H");
    expect(host.textContent).toContain("Angle");
    expect(getFlatRowInput(host, "W").value).toBe("257.4px");
    expect(getFlatRowInput(host, "Y").value).toBe("-24px");
    act(() => root.unmount());
  });

  it("commits an X edit through commitManualOffset", () => {
    const commitManualOffset = vi.fn();
    const { host, root } = renderInto(
      <LayoutGeometryRows {...baseGeometryProps({ commitManualOffset })} />,
    );
    const input = host.querySelectorAll("input")[0];
    if (!input) throw new Error("expected an X input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "40px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(commitManualOffset).toHaveBeenCalledWith("x", "40px");
    act(() => root.unmount());
  });

  it("wraps the keyframe gutter cluster at 30% opacity when the property has no keyframes", () => {
    const { host, root } = renderInto(
      <LayoutGeometryRows {...baseGeometryProps({ gsapAnimId: "anim-1", navKeyframes: null })} />,
    );
    const dimmed = host.querySelectorAll('[data-flat-kf-gutter="true"][style*="opacity: 0.3"]');
    expect(dimmed.length).toBeGreaterThan(0);
    act(() => root.unmount());
  });

  it("does not dim the gutter cluster when the property has keyframes", () => {
    const { host, root } = renderInto(
      <LayoutGeometryRows
        {...baseGeometryProps({
          gsapAnimId: "anim-1",
          navKeyframes: [{ percentage: 0, properties: { x: 0 } }],
        })}
      />,
    );
    const full = host.querySelectorAll('[data-flat-kf-gutter="true"][style*="opacity: 1"]');
    expect(full.length).toBeGreaterThan(0);
    act(() => root.unmount());
  });
});

describe("LayoutZIndexRow", () => {
  it("renders the current z-index at the default tier and commits edits", () => {
    const onSetStyle = vi.fn();
    const { host, root } = renderInto(
      <LayoutZIndexRow styles={{ "z-index": "3" }} onSetStyle={onSetStyle} />,
    );
    expect(host.textContent).toContain("Z-index");
    const input = host.querySelector("input");
    if (!input) throw new Error("expected an input");
    expect(input.value).toBe("3");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(onSetStyle).toHaveBeenCalledWith("z-index", "5");
    act(() => root.unmount());
  });
});

describe("LayoutFlexBlock", () => {
  it("renders nothing when the element is not flex", () => {
    const { host, root } = renderInto(
      <LayoutFlexBlock styles={{ display: "block" }} onSetStyle={vi.fn()} disabled={false} />,
    );
    expect(host.textContent).toBe("");
    act(() => root.unmount());
  });

  it("renders direction/justify/align/gap and commits a direction change", () => {
    const onSetStyle = vi.fn();
    const { host, root } = renderInto(
      <LayoutFlexBlock
        styles={{ display: "flex", "flex-direction": "row", gap: "8px" }}
        onSetStyle={onSetStyle}
        disabled={false}
      />,
    );
    expect(host.textContent).toContain("Flex");
    const columnOption = Array.from(host.querySelectorAll('[data-flat-segment="true"]')).find(
      (el) => el.textContent === "Column",
    );
    if (!columnOption) throw new Error("expected a Column segment option");
    act(() =>
      (columnOption as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onSetStyle).toHaveBeenCalledWith("flex-direction", "column");
    act(() => root.unmount());
  });
});

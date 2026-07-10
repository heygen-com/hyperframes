// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlatGroupHeader,
  FlatRow,
  FlatSegmentedRow,
  FlatSelectRow,
  FlatSlider,
  FlatToggle,
} from "./propertyPanelFlatPrimitives";

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

describe("FlatRow", () => {
  it("renders the default tier with no reset button", () => {
    const { host, root } = renderInto(
      <FlatRow label="Weight" value="400 · Regular" tier="default" onCommit={vi.fn()} />,
    );
    const value = host.querySelector('[data-flat-row-value="true"]');
    expect(value?.className).toContain("text-panel-text-3");
    expect(host.querySelector('[data-flat-row-reset="true"]')).toBeNull();
    act(() => root.unmount());
  });

  it("renders the explicitCustom tier with a mint value and a reset button", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatRow
        label="Letter spacing"
        value="3.96px"
        tier="explicitCustom"
        onCommit={vi.fn()}
        onReset={onReset}
      />,
    );
    const value = host.querySelector('[data-flat-row-value="true"]');
    expect(value?.className).toContain("text-panel-accent");
    const reset = host.querySelector<HTMLButtonElement>('[data-flat-row-reset="true"]');
    expect(reset).not.toBeNull();
    act(() => reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("commits edits through the underlying CommitField input", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatRow label="Size" value="22px" tier="explicitDefault" onCommit={onCommit} />,
    );
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("expected an input");
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "24px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("24px");
    act(() => root.unmount());
  });
});

describe("FlatSegmentedRow", () => {
  it("underlines the active option in mint and leaves others muted", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatSegmentedRow
        label="Align"
        options={[
          { key: "left", node: "L", active: false },
          { key: "right", node: "R", active: true },
        ]}
        onChange={onChange}
      />,
    );
    const options = host.querySelectorAll('[data-flat-segment="true"]');
    expect(options).toHaveLength(2);
    expect((options[0] as HTMLElement).className).toContain("text-panel-text-4");
    expect((options[1] as HTMLElement).className).toContain("border-panel-accent");
    act(() =>
      (options[0] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onChange).toHaveBeenCalledWith("left");
    act(() => root.unmount());
  });
});

describe("FlatGroupHeader", () => {
  it("renders the open header (name + caret), with no sticky-related props required", () => {
    const onToggleOpen = vi.fn();
    const { host, root } = renderInto(
      <FlatGroupHeader title="Text" isOpen onToggleOpen={onToggleOpen} />,
    );
    expect(host.textContent).toContain("Text");
    const collapse = host.querySelector<HTMLButtonElement>('button[title="Collapse"]');
    act(() => collapse?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("renders the collapsed row (name + summary + caret-right) with no sticky positioning", () => {
    const onToggleOpen = vi.fn();
    const { host, root } = renderInto(
      <FlatGroupHeader
        title="Style"
        isOpen={false}
        onToggleOpen={onToggleOpen}
        summary="fill none · 100%"
      />,
    );
    expect(host.textContent).toContain("fill none · 100%");
    const row = host.querySelector<HTMLButtonElement>('[data-flat-group-collapsed="true"]');
    expect(row?.style.position).toBe("");
    act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("applies the entrance animation class to both states, only when animateEntrance is set", () => {
    const { host: openHost, root: openRoot } = renderInto(
      <FlatGroupHeader title="Text" isOpen onToggleOpen={vi.fn()} animateEntrance />,
    );
    expect(openHost.firstElementChild?.className).toContain("hf-flat-group-enter");
    act(() => openRoot.unmount());

    const { host: collapsedHost, root: collapsedRoot } = renderInto(
      <FlatGroupHeader title="Style" isOpen={false} onToggleOpen={vi.fn()} animateEntrance />,
    );
    const row = collapsedHost.querySelector('[data-flat-group-collapsed="true"]');
    expect(row?.className).toContain("hf-flat-group-enter");
    act(() => collapsedRoot.unmount());
  });

  it("omits the entrance animation class in both states when animateEntrance is not set", () => {
    const { host: openHost, root: openRoot } = renderInto(
      <FlatGroupHeader title="Text" isOpen onToggleOpen={vi.fn()} />,
    );
    expect(openHost.firstElementChild?.className).not.toContain("hf-flat-group-enter");
    act(() => openRoot.unmount());

    const { host: collapsedHost, root: collapsedRoot } = renderInto(
      <FlatGroupHeader title="Style" isOpen={false} onToggleOpen={vi.fn()} />,
    );
    const row = collapsedHost.querySelector('[data-flat-group-collapsed="true"]');
    expect(row?.className).not.toContain("hf-flat-group-enter");
    act(() => collapsedRoot.unmount());
  });

  it("renders no inline position styling in either state (collapsed headers never move)", () => {
    const { host: collapsedHost, root: collapsedRoot } = renderInto(
      <FlatGroupHeader title="Layout" isOpen={false} onToggleOpen={vi.fn()} />,
    );
    const row = collapsedHost.querySelector<HTMLButtonElement>(
      '[data-flat-group-collapsed="true"]',
    );
    expect(row?.getAttribute("style")).toBeNull();
    act(() => collapsedRoot.unmount());

    const { host: openHost, root: openRoot } = renderInto(
      <FlatGroupHeader title="Motion" isOpen onToggleOpen={vi.fn()} />,
    );
    expect(openHost.textContent).toContain("Motion");
    expect(openHost.querySelector("[style]")).toBeNull();
    act(() => openRoot.unmount());
  });
});

describe("FlatSlider", () => {
  it("renders the default tier with a dim knob at the correct position", () => {
    const { host, root } = renderInto(
      <FlatSlider
        label="Layer blur"
        value={0}
        min={0}
        max={40}
        tier="default"
        displayValue="0px"
        onCommit={vi.fn()}
      />,
    );
    const knob = host.querySelector<HTMLElement>('[data-flat-slider-knob="true"]');
    expect(knob).not.toBeNull();
    expect(knob?.className).toContain("bg-panel-text-4");
    expect(knob?.style.left).toBe("0%");
    const value = host.querySelector('[data-flat-slider-value="true"]');
    expect(value?.className).toContain("text-panel-text-3");
    expect(value?.textContent).toBe("0px");
    act(() => root.unmount());
  });

  it("renders the explicitCustom tier with a filled track and bright knob", () => {
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={100}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="100%"
        onCommit={vi.fn()}
      />,
    );
    const fill = host.querySelector<HTMLElement>('[data-flat-slider-fill="true"]');
    expect(fill?.style.width).toBe("100%");
    const knob = host.querySelector<HTMLElement>('[data-flat-slider-knob="true"]');
    expect(knob?.className).toContain("bg-white");
    act(() => root.unmount());
  });

  it("commits a value on track click, proportional to click position", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={50}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="50%"
        onCommit={onCommit}
      />,
    );
    const track = host.querySelector<HTMLElement>('[data-flat-slider-track="true"]');
    if (!track) throw new Error("expected a track element");
    Object.defineProperty(track, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 2, right: 200, bottom: 2 }),
    });
    act(() => {
      track.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    });
    expect(onCommit).toHaveBeenCalledWith(50);
    act(() => root.unmount());
  });

  it("widens the click/drag hit area vertically beyond the thin visible line", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={50}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="50%"
        onCommit={onCommit}
      />,
    );
    const track = host.querySelector<HTMLElement>('[data-flat-slider-track="true"]');
    if (!track) throw new Error("expected a track element");
    Object.defineProperty(track, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20 }),
    });
    act(() => {
      track.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 18 }),
      );
    });
    expect(onCommit).toHaveBeenCalledWith(10);
    act(() => root.unmount());
  });

  it("commits continuously while dragging, not just on the initial pointerdown", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={50}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="50%"
        onCommit={onCommit}
      />,
    );
    const track = host.querySelector<HTMLElement>('[data-flat-slider-track="true"]');
    if (!track) throw new Error("expected a track element");
    Object.defineProperty(track, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20 }),
    });
    act(() => {
      track.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 20, pointerId: 1 }),
      );
    });
    expect(onCommit).toHaveBeenLastCalledWith(10);
    act(() => {
      track.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 160, pointerId: 1 }),
      );
    });
    expect(onCommit).toHaveBeenLastCalledWith(80);
    act(() => {
      track.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 100, pointerId: 1 }),
      );
    });
    expect(onCommit).toHaveBeenLastCalledWith(50);
    act(() => {
      track.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    });
    act(() => root.unmount());
  });

  it("ignores pointermove once a drag has ended (pointer capture released)", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={50}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="50%"
        onCommit={onCommit}
      />,
    );
    const track = host.querySelector<HTMLElement>('[data-flat-slider-track="true"]');
    if (!track) throw new Error("expected a track element");
    Object.defineProperty(track, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20 }),
    });
    act(() => {
      track.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 20, pointerId: 1 }),
      );
      track.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    });
    onCommit.mockClear();
    act(() => {
      track.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 160, pointerId: 1 }),
      );
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("FlatSlider — Grade extensions", () => {
  it("renders a center tick when centerTick is true, and omits it by default", () => {
    const { host: withTick, root: rootA } = renderInto(
      <FlatSlider
        label="Exposure"
        value={0}
        min={-100}
        max={100}
        tier="default"
        displayValue="+0.00"
        centerTick
        onCommit={vi.fn()}
      />,
    );
    expect(withTick.querySelector('[data-flat-slider-center-tick="true"]')).not.toBeNull();
    act(() => rootA.unmount());

    const { host: withoutTick, root: rootB } = renderInto(
      <FlatSlider
        label="Layer blur"
        value={0}
        min={0}
        max={100}
        tier="default"
        displayValue="0px"
        onCommit={vi.fn()}
      />,
    );
    expect(withoutTick.querySelector('[data-flat-slider-center-tick="true"]')).toBeNull();
    act(() => rootB.unmount());
  });

  it("always reserves a 14px reset slot, showing the icon only when set and onReset is provided", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Contrast"
        value={12}
        min={-100}
        max={100}
        tier="explicitCustom"
        displayValue="+12%"
        centerTick
        onReset={onReset}
        onCommit={vi.fn()}
      />,
    );
    const slot = host.querySelector('[data-flat-slider-reset-slot="true"]');
    expect(slot).not.toBeNull();
    const resetButton = host.querySelector<HTMLButtonElement>('[data-flat-slider-reset="true"]');
    expect(resetButton).not.toBeNull();
    act(() => resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());

    const { host: unsetHost, root: rootB } = renderInto(
      <FlatSlider
        label="Contrast"
        value={0}
        min={-100}
        max={100}
        tier="default"
        displayValue="0%"
        centerTick
        onCommit={vi.fn()}
      />,
    );
    expect(unsetHost.querySelector('[data-flat-slider-reset-slot="true"]')).not.toBeNull();
    expect(unsetHost.querySelector('[data-flat-slider-reset="true"]')).toBeNull();
    act(() => rootB.unmount());
  });

  it("renders no reset slot at all when centerTick is omitted, matching existing Style/Media callers", () => {
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={100}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="100%"
        onCommit={vi.fn()}
      />,
    );
    expect(host.querySelector('[data-flat-slider-reset-slot="true"]')).toBeNull();
    expect(host.querySelector('[data-flat-slider-reset="true"]')).toBeNull();
    act(() => root.unmount());
  });
});

describe("FlatSelectRow", () => {
  it("renders the default tier with no reset button", () => {
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Blend"
        value="normal"
        options={["normal", "multiply", "screen"]}
        tier="default"
        onChange={vi.fn()}
      />,
    );
    const select = host.querySelector("select");
    expect(select?.value).toBe("normal");
    expect(host.querySelector('[data-flat-select-reset="true"]')).toBeNull();
    act(() => root.unmount());
  });

  it("renders the explicitCustom tier with a reset button and fires onReset", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Shadow"
        value="soft"
        options={["none", "soft", "lift", "glow"]}
        tier="explicitCustom"
        onChange={vi.fn()}
        onReset={onReset}
      />,
    );
    const select = host.querySelector<HTMLSelectElement>("select");
    expect(select?.className).toContain("text-panel-accent");
    const reset = host.querySelector<HTMLButtonElement>('[data-flat-select-reset="true"]');
    act(() => reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("fires onChange when the select value changes", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="visible"
        options={["visible", "hidden", "clip", "auto", "scroll"]}
        tier="default"
        onChange={onChange}
      />,
    );
    const select = host.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("expected a select");
    act(() => {
      select.value = "hidden";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("hidden");
    act(() => root.unmount());
  });
});

describe("FlatSelectRow — label/value options", () => {
  it("renders distinct labels for entries with a different display label than value", () => {
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Preset"
        value="natural-lift"
        options={[
          { value: "neutral", label: "Neutral" },
          { value: "natural-lift", label: "Natural Lift" },
          { value: "fresh-pop", label: "Fresh Pop" },
        ]}
        tier="explicitCustom"
        onChange={vi.fn()}
      />,
    );
    const select = host.querySelector("select");
    expect(select?.value).toBe("natural-lift");
    const options = Array.from(host.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Neutral", "Natural Lift", "Fresh Pop"]);
    act(() => root.unmount());
  });

  it("still treats a bare string array as value===label (Plan 2 behavior unchanged)", () => {
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Blend"
        value="multiply"
        options={["normal", "multiply", "screen"]}
        tier="explicitCustom"
        onChange={vi.fn()}
      />,
    );
    const options = Array.from(host.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["normal", "multiply", "screen"]);
    act(() => root.unmount());
  });
});

describe("FlatToggle", () => {
  it("renders the off state with a dim label and dim knob, and fires onChange(true) on click", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatToggle label="Loop" checked={false} onChange={onChange} />,
    );
    const label = host.querySelector('[data-flat-toggle-label="true"]');
    expect(label?.className).toContain("text-panel-text-3");
    const pill = host.querySelector<HTMLButtonElement>('[data-flat-toggle="true"]');
    expect(pill).not.toBeNull();
    act(() => pill?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(true);
    act(() => root.unmount());
  });

  it("renders the on state with an emphasized label and mint knob, and fires onChange(false) on click", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(<FlatToggle label="Loop" checked onChange={onChange} />);
    const label = host.querySelector('[data-flat-toggle-label="true"]');
    expect(label?.className).toContain("text-panel-text-2");
    const knob = host.querySelector('[data-flat-toggle-knob="true"]');
    expect(knob?.className).toContain("bg-panel-accent");
    const pill = host.querySelector<HTMLButtonElement>('[data-flat-toggle="true"]');
    act(() => pill?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(false);
    act(() => root.unmount());
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatToggle label="Loop" checked={false} disabled onChange={onChange} />,
    );
    const pill = host.querySelector<HTMLButtonElement>('[data-flat-toggle="true"]');
    expect(pill?.disabled).toBe(true);
    act(() => pill?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

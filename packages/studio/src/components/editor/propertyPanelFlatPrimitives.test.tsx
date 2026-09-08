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
    const value = host.querySelector('[data-testid="inspector-field"]');
    expect(value?.className).toContain("text-text-3");
    expect(host.querySelector('[data-flat-row-reset="true"]')).toBeNull();
    act(() => root.unmount());
  });

  it("right-aligns the value input — the flat inspector's justify-between row layout leaves a left-aligned value looking stranded at the edge of its own box", () => {
    const { host, root } = renderInto(
      <FlatRow label="Size" value="72px" tier="explicitCustom" onCommit={vi.fn()} />,
    );
    const input = host.querySelector("input");
    expect(input?.className).toContain("text-right");
    expect(input?.className).not.toContain("text-left");
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
    const value = host.querySelector('[data-testid="inspector-field"]');
    expect(value?.className).toContain("text-accent");
    // R10: the value's own boundary, so the field reads as a field before it
    // is clicked. It used to be bare text with an underline drawn around it.
    expect(value?.className).toContain("border");
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

  it("restores its durable value when an async commit rejects", async () => {
    let rejectCommit: ((error: Error) => void) | null = null;
    const onCommit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    const row = (value: string) => (
      <FlatRow label="X" value={value} tier="explicitDefault" onCommit={onCommit} />
    );
    const { host, root } = renderInto(row("22px"));
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("expected an input");
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "99px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    // The parent can echo the preview before persistence settles. That is not a
    // durable acknowledgement and must not invalidate the pending rollback.
    act(() => root.render(row("99px")));
    await act(async () => {
      rejectCommit?.(new Error("save failed"));
      await Promise.resolve();
    });

    expect(onCommit).toHaveBeenCalledWith("99px");
    expect(input.value).toBe("22px");
    act(() => root.unmount());
  });

  it("does not let an older rejected commit overwrite a newer draft", async () => {
    let rejectCommit: ((error: Error) => void) | null = null;
    const onCommit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    const { host, root } = renderInto(
      <FlatRow label="X" value="22px" tier="explicitDefault" onCommit={onCommit} />,
    );
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("expected an input");
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      nativeInputValueSetter?.call(input, "99px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
      nativeInputValueSetter?.call(input, "100px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      rejectCommit?.(new Error("old save failed"));
      await Promise.resolve();
    });

    expect(input.value).toBe("100px");
    act(() => root.unmount());
  });

  it("persists a rapid numeric arrow-key burst as one commit", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    const { host, root } = renderInto(
      <FlatRow
        label="Size"
        value="22px"
        tier="explicitDefault"
        liveCommit
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("expected an input");

    for (let step = 0; step < 8; step += 1) {
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      });
    }

    expect(input.value).toBe("30px");
    expect(onPreview).toHaveBeenLastCalledWith("30px");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("30px");

    act(() => root.unmount());
    vi.useRealTimers();
  });
});

describe("FlatSegmentedRow", () => {
  it("underlines the active option in mint and leaves others muted", () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatSegmentedRow
        label="Align"
        options={[
          { key: "left", node: "L", label: "left", active: false },
          { key: "right", node: "R", label: "right", active: true },
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

  it("gives each option an accessible name and pressed state — glyphs alone (e.g. two 'A' buttons) aren't a valid accessible name", () => {
    const { host, root } = renderInto(
      <FlatSegmentedRow
        label="Case · Style"
        options={[
          { key: "normal", node: "A", label: "upright", active: true },
          { key: "italic", node: "A", label: "italic", active: false },
        ]}
        onChange={vi.fn()}
      />,
    );
    const options = host.querySelectorAll<HTMLButtonElement>('[data-flat-segment="true"]');
    expect(options[0]?.getAttribute("aria-label")).toBe("upright");
    expect(options[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(options[1]?.getAttribute("aria-label")).toBe("italic");
    expect(options[1]?.getAttribute("aria-pressed")).toBe("false");
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

/* ------------------------------------------------------------------ */
/*  Shared harness for the two rows that now wrap a Base UI control.   */
/* ------------------------------------------------------------------ */

/** Base UI moves focus and mounts a popup a task later; happy-dom is no faster. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

/** happy-dom has no layout, so Base UI's pointer maths needs a rect given to it. */
function stubRect(el: Element, width = 100) {
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 24, width, height: 24 }) as DOMRect;
}

function sliderControl(host: HTMLElement, width = 100) {
  const control = host.querySelector<HTMLElement>("[data-slider-control]");
  if (!control) throw new Error("expected a slider control");
  stubRect(control, width);
  return control;
}

/** The thumb's own input: where the value, the range and the keyboard live. */
function sliderInput(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type="range"]');
  if (!input) throw new Error("expected a slider input");
  return input;
}

function fire(el: Element, type: string, init: MouseEventInit & { key?: string } = {}) {
  const event =
    init.key === undefined
      ? new MouseEvent(type, { bubbles: true, ...init })
      : new KeyboardEvent(type, { bubbles: true, key: init.key });
  act(() => void el.dispatchEvent(event));
}

/** `buttons: 1` is not decoration: Base UI reads it to tell a live drag from a
 *  move whose pointerup another element swallowed. */
const move = (clientX: number) =>
  act(() => void document.dispatchEvent(new MouseEvent("pointermove", { clientX, buttons: 1 })));
const release = (clientX: number) =>
  act(() => void document.dispatchEvent(new MouseEvent("pointerup", { clientX, buttons: 0 })));

describe("FlatSlider", () => {
  it("shows the display value, tinted by tier", () => {
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
    const value = host.querySelector('[data-flat-slider-value="true"]');
    expect(value?.textContent).toBe("0px");
    expect(value?.className).toContain("text-text-3");
    // The thumb reports the value to assistive tech, which the hand-rolled
    // knob only did because it carried the aria attributes by hand.
    expect(sliderInput(host).getAttribute("aria-valuenow")).toBe("0");
    act(() => root.unmount());
  });

  it("marks an explicitly set value with the bright tier", () => {
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
    const value = host.querySelector('[data-flat-slider-value="true"]');
    expect(value?.className).toContain("text-text-0");
    expect(sliderInput(host).getAttribute("aria-valuenow")).toBe("100");
    act(() => root.unmount());
  });

  it("commits a value proportional to where the track was pressed", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={10}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="10%"
        onCommit={onCommit}
      />,
    );
    const control = sliderControl(host);

    fire(control, "pointerdown", { clientX: 50, button: 0 });
    release(50);

    expect(onCommit.mock.calls).toEqual([[50]]);
    act(() => root.unmount());
  });

  it("writes twice for a drag from 10 to 40 across five intermediate moves, not once per move", () => {
    // The row's onCommit IS the live canvas preview, so mid-drag writes are the
    // point; what must not happen is one write per pointermove. Five moves get
    // a leading-edge write and then the released value, because the rest land
    // inside the same throttle window.
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={10}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="10%"
        onCommit={onCommit}
      />,
    );
    const control = sliderControl(host);

    fire(control, "pointerdown", { clientX: 10, button: 0 });
    for (const x of [15, 20, 25, 30, 40]) move(x);
    release(40);

    expect(onCommit).toHaveBeenLastCalledWith(40);
    expect(onCommit.mock.calls.length).toBeLessThanOrEqual(2);
    act(() => root.unmount());
  });

  /** Past the throttle window, so a queued write actually lands. */
  const past = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

  /**
   * The three ways a drag is abandoned rather than finished. All three have to
   * put back the value the drag started from, and the interesting part is that
   * a mid-drag write has ALREADY applied an intermediate value to the document
   * by then, so an abort that merely stopped listening would leave the canvas
   * wherever the pointer happened to be.
   */
  const aborts = [
    ["the right button", (control: HTMLElement) => fire(control, "contextmenu", { button: 2 })],
    ["the platform cancelling the gesture", (c: HTMLElement) => fire(c, "pointercancel", {})],
    ["Escape", (control: HTMLElement) => fire(control, "keydown", { key: "Escape" })],
  ] as const;

  it.each(aborts)("reverts a drag in flight aborted with %s (KTD8)", async (_name, abort) => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={10}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="10%"
        onCommit={onCommit}
      />,
    );
    const control = sliderControl(host);

    fire(control, "pointerdown", { clientX: 10, button: 0 });
    move(60);
    expect(onCommit.mock.calls).toEqual([[60]]);

    abort(control);
    // The pointer is still down: the abort has to stop Base UI applying any
    // further move, not merely reset the number once.
    move(90);
    release(90);
    await past();

    expect(sliderInput(host).value).toBe("10");
    expect(onCommit.mock.calls).toEqual([[60], [10]]);
    act(() => root.unmount());
  });

  it("steps with the arrow keys and clamps with Home and End", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Volume"
        value={50}
        min={0}
        max={100}
        tier="default"
        displayValue="50%"
        onCommit={onCommit}
      />,
    );
    const input = sliderInput(host);
    expect(input.min).toBe("0");
    expect(input.max).toBe("100");

    fire(input, "keydown", { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith(51);
    fire(input, "keydown", { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(0);
    fire(input, "keydown", { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(100);
    act(() => root.unmount());
  });

  it("ignores the committed value echoing back mid-drag, so the thumb does not snap", () => {
    const onCommit = vi.fn();
    function Harness() {
      const [value, setValue] = React.useState(10);
      return (
        <FlatSlider
          label="Opacity"
          value={value}
          min={0}
          max={100}
          tier="explicitCustom"
          displayValue={`${value}%`}
          onCommit={(next) => {
            onCommit(next);
            setValue(next);
          }}
        />
      );
    }
    const { host, root } = renderInto(<Harness />);
    const control = sliderControl(host);

    fire(control, "pointerdown", { clientX: 30, button: 0 });
    expect(onCommit).toHaveBeenCalledWith(30);
    move(60);

    // 60, not the 30 the parent echoed back a render later.
    expect(sliderInput(host).value).toBe("60");
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

  it("renders no reset slot at all when neither centerTick nor onReset is provided", () => {
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

  it("shows a reachable reset button on a non-centerTick slider that passes onReset (Grade Vignette/Effects)", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Vignette"
        value={18}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="18%"
        onReset={onReset}
        onCommit={vi.fn()}
      />,
    );
    const resetButton = host.querySelector<HTMLButtonElement>('[data-flat-slider-reset="true"]');
    expect(resetButton).not.toBeNull();
    act(() => resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("never commits from a press released on a disabled slider", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={100}
        min={0}
        max={100}
        tier="default"
        displayValue="100%"
        disabled
        onCommit={onCommit}
      />,
    );
    const control = sliderControl(host, 200);

    fire(control, "pointerdown", { clientX: 50, button: 0 });
    release(50);

    expect(onCommit).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("disables the reset button when the slider itself is disabled", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Exposure"
        value={20}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="20"
        disabled
        onReset={onReset}
        onCommit={vi.fn()}
      />,
    );
    const resetButton = host.querySelector<HTMLButtonElement>('[data-flat-slider-reset="true"]');
    expect(resetButton?.disabled).toBe(true);
    act(() => resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("a trailing throttled write uses the current render's onCommit, not the one captured when it was scheduled", async () => {
    const onCommitA = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Exposure"
        value={0}
        min={-100}
        max={100}
        tier="explicitCustom"
        displayValue="0"
        onCommit={onCommitA}
      />,
    );
    const control = sliderControl(host, 200);

    // Leading edge: clientX 150 on a 200px, -100..100 track is 50.
    fire(control, "pointerdown", { clientX: 150, button: 0 });
    expect(onCommitA).toHaveBeenCalledTimes(1);
    // Inside the throttle window, so this queues rather than writes.
    move(180);
    expect(onCommitA).toHaveBeenCalledTimes(1);

    // The real race: something else re-renders this row with a NEW onCommit
    // closure before the queued write fires. Grade's per-detail onCommit
    // spreads the render-time grading object, so a stale closure winning here
    // would silently revert whatever changed in between.
    const onCommitB = vi.fn();
    act(() => {
      root.render(
        <FlatSlider
          label="Exposure"
          value={0}
          min={-100}
          max={100}
          tier="explicitCustom"
          displayValue="0"
          onCommit={onCommitB}
        />,
      );
    });
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));

    expect(onCommitB.mock.calls).toEqual([[80]]);
    expect(onCommitA).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("flushes a still-queued trailing write on unmount instead of dropping it", () => {
    const onCommit = vi.fn();
    const { host, root } = renderInto(
      <FlatSlider
        label="Opacity"
        value={5}
        min={0}
        max={100}
        tier="explicitCustom"
        displayValue="5%"
        onCommit={onCommit}
      />,
    );
    const control = sliderControl(host, 200);

    fire(control, "pointerdown", { clientX: 20, button: 0 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    // Queues a write that never gets to fire before the row goes away.
    move(160);
    expect(onCommit).toHaveBeenCalledTimes(1);

    act(() => root.unmount());

    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenNthCalledWith(2, 80);
  });
});

/* ------------------------------------------------------------------ */
/*  FlatSelectRow                                                      */
/* ------------------------------------------------------------------ */

function selectTrigger(host: HTMLElement) {
  const trigger = host.querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) throw new Error("expected a select trigger");
  return trigger;
}

/** Opens the popup and returns its options, which only exist while open. */
async function openOptions(host: HTMLElement) {
  act(() => selectTrigger(host).click());
  await settle();
  return [...document.querySelectorAll('[role="option"]')] as HTMLElement[];
}

async function choose(host: HTMLElement, text: string) {
  const options = await openOptions(host);
  const option = options.find((el) => el.textContent === text);
  if (!option) throw new Error(`no option "${text}" among ${options.map((o) => o.textContent)}`);
  act(() => option.click());
  await settle();
}

describe("FlatSelectRow", () => {
  it("renders the default tier with no reset button", () => {
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="visible"
        options={["visible", "hidden"]}
        tier="default"
        onChange={vi.fn()}
      />,
    );
    expect(selectTrigger(host).textContent).toContain("visible");
    expect(host.querySelector('[data-flat-select-reset="true"]')).toBeNull();
    act(() => root.unmount());
  });

  it("boxes the trigger the way the row's other fields are boxed", () => {
    // R10 and R8 together: the value carries its own boundary, and it is the
    // same boundary the text fields wear, not a native control's.
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="hidden"
        options={["visible", "hidden"]}
        tier="explicitDefault"
        onChange={vi.fn()}
      />,
    );
    const trigger = selectTrigger(host);
    expect(trigger.className).toContain("border-border-input");
    expect(trigger.className).toContain("bg-input");
    act(() => root.unmount());

    // An explicitly set value tints that same box, and `cn` has to let the
    // tint win over the base border rather than leave both classes standing.
    const { host: custom, root: rootB } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="hidden"
        options={["visible", "hidden"]}
        tier="explicitCustom"
        onChange={vi.fn()}
      />,
    );
    const tinted = selectTrigger(custom);
    expect(tinted.className).toContain("border-accent/30");
    expect(tinted.className).not.toContain("border-border-input");
    expect(tinted.className).toContain("text-accent");
    act(() => rootB.unmount());
  });

  it("renders the explicitCustom tier with a reset button and fires onReset", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="hidden"
        options={["visible", "hidden"]}
        tier="explicitCustom"
        onChange={vi.fn()}
        onReset={onReset}
      />,
    );
    const reset = host.querySelector<HTMLButtonElement>('[data-flat-select-reset="true"]');
    expect(reset).not.toBeNull();
    act(() => reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("disables the reset button, and names the trigger, when the row itself is disabled", () => {
    const onReset = vi.fn();
    const { host, root } = renderInto(
      <FlatSelectRow
        label=""
        ariaLabel="Preset"
        value="warm"
        options={["neutral", "warm"]}
        tier="explicitCustom"
        disabled
        onChange={vi.fn()}
        onReset={onReset}
      />,
    );
    const trigger = selectTrigger(host);
    expect(trigger.getAttribute("aria-label")).toBe("Preset");
    expect(trigger.hasAttribute("disabled")).toBe(true);
    const reset = host.querySelector<HTMLButtonElement>('[data-flat-select-reset="true"]');
    expect(reset?.disabled).toBe(true);
    act(() => reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onReset).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("commits the chosen option's literal value", async () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="visible"
        options={["visible", "hidden", "scroll"]}
        tier="default"
        onChange={onChange}
      />,
    );

    await choose(host, "scroll");

    expect(onChange.mock.calls).toEqual([["scroll"]]);
    act(() => root.unmount());
  });
});

describe("FlatSelectRow — label/value options", () => {
  it("renders distinct labels for entries with a different display label than value", async () => {
    const onChange = vi.fn();
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Weight"
        value="400"
        options={[
          { value: "400", label: "400 · Regular" },
          { value: "600", label: "600 · Semibold" },
        ]}
        tier="default"
        onChange={onChange}
      />,
    );
    expect(selectTrigger(host).textContent).toContain("400 · Regular");

    await choose(host, "600 · Semibold");

    // The literal union value, not its display label.
    expect(onChange.mock.calls).toEqual([["600"]]);
    act(() => root.unmount());
  });

  it("still treats a bare string array as value===label", async () => {
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Overflow"
        value="visible"
        options={["visible", "hidden", "clip"]}
        tier="default"
        onChange={vi.fn()}
      />,
    );
    const options = await openOptions(host);
    expect(options.map((el) => el.textContent)).toEqual(["visible", "hidden", "clip"]);
    act(() => root.unmount());
  });

  it("preserves a valid authored value outside the preset list instead of dropping it", async () => {
    // A `mix-blend-mode` this row does not offer as a preset still has to be
    // displayable, or the row shows nothing and any choice silently overwrites
    // a value the user never saw.
    const { host, root } = renderInto(
      <FlatSelectRow
        label="Blend"
        value="color-dodge"
        options={["normal", "multiply"]}
        tier="explicitCustom"
        onChange={vi.fn()}
      />,
    );
    expect(selectTrigger(host).textContent).toContain("color-dodge");
    const options = await openOptions(host);
    expect(options.map((el) => el.textContent)).toEqual(["color-dodge", "normal", "multiply"]);
    act(() => root.unmount());
  });
});

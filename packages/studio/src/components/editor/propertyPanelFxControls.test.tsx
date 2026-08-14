// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FxParamRow } from "./propertyPanelFxControls";
import type { HfAudioFxNumberParam } from "@hyperframes/core/audio-fx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

/** A frequency knob: wide range, so a clamp to the minimum is unmistakable. */
const FREQUENCY: HfAudioFxNumberParam = {
  kind: "number",
  key: "frequency",
  label: "Frequency",
  min: 20,
  max: 20000,
  step: 1,
  default: 1000,
  unit: "Hz",
};

/** React tracks its own value on the node, so a plain assignment is ignored. */
function setInputValue(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mount(value: number) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  let root!: Root;
  act(() => {
    root = createRoot(host);
    root.render(
      <FxParamRow param={FREQUENCY} value={value} onChange={onChange} onCommit={onCommit} />,
    );
  });
  const number = () => host.querySelector<HTMLInputElement>(".hf-fx-number")!;
  const slider = () => host.querySelector<HTMLInputElement>(".hf-fx-slider")!;
  const type = (text: string) => {
    act(() => {
      number().focus();
      setInputValue(number(), text);
    });
  };
  /** A new value arrives through the prop — a carve, or an undo. */
  const receive = (next: number) => {
    act(() => {
      root.render(
        <FxParamRow param={FREQUENCY} value={next} onChange={onChange} onCommit={onCommit} />,
      );
    });
  };
  return { host, number, slider, onChange, onCommit, type, receive };
}

describe("FxParamRow number field", () => {
  it("shows what is being typed instead of snapping back to the stored value", () => {
    // Every keystroke is clamped and written live, and the live write does not
    // refresh the prop — so a field bound to the committed value put the old
    // number straight back. Typing 5000 wrote 20 on the first keystroke and the
    // knob could not be typed into at all, only dragged.
    const { number, type } = mount(1000);
    type("5");
    expect(number().value).toBe("5");
    type("5000");
    expect(number().value).toBe("5000");
  });

  it("does not write the parameter minimum while the field is empty", () => {
    // `Number("") === 0` passes Number.isFinite, so select-all + Delete before
    // retyping used to clamp to the minimum and live-write it — 20 Hz here.
    const { onChange, type } = mount(1000);
    type("");
    expect(onChange).not.toHaveBeenCalled();
    type("800");
    expect(onChange).toHaveBeenLastCalledWith("frequency", 800);
  });
});

describe("FxParamRow commit", () => {
  it("stays quiet when a gesture changed nothing", () => {
    // commit() hangs off pointerup, keyup and blur, all reachable without an
    // edit. Firing then costs a source patch, a selection resync, a preview
    // reload and an audio restart for a gesture that moved nothing.
    const { slider, number, onCommit } = mount(1000);
    act(() => slider().dispatchEvent(new Event("pointerup", { bubbles: true })));
    act(() => number().dispatchEvent(new Event("blur", { bubbles: true })));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not re-persist a stale value over a change that arrived meanwhile", () => {
    // The scenario: open an EQ row, run the carve (or press undo), which
    // rewrites the chain so this row's value becomes 400. Then click the slider
    // thumb and release without moving it. `latest` was seeded at mount and only
    // written by an edit, so it still held 1000 — and the release wrote it back,
    // undoing the carve with no gesture that looks like an edit.
    const { slider, onCommit, type, receive } = mount(1000);
    // An edit happened earlier in this row's life, so `latest` holds 1000.
    type("1000");
    act(() => slider().dispatchEvent(new Event("pointerup", { bubbles: true })));
    onCommit.mockClear();

    receive(400);
    act(() => slider().dispatchEvent(new Event("pointerup", { bubbles: true })));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

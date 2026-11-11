// @vitest-environment happy-dom
import React, { act } from "react";
import { expect, it, vi } from "vitest";
import { PreviewSeekBar } from "./PreviewSeekBar";
import { createHappyDomRootHarness } from "./testRootHarness";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { mount } = createHappyDomRootHarness();

it("marks keyboard and released seeks as settled and pointer scrubbing as interactive", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const onSeek = vi.fn();
  act(() => mount(host).render(<PreviewSeekBar duration={10} disabled={false} onSeek={onSeek} />));
  const input = host.querySelector("input")!;
  const change = (value: number) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    change(1);
  });
  expect(onSeek).toHaveBeenLastCalledWith(1, { settled: true });
  act(() => {
    input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    change(2);
  });
  expect(onSeek).toHaveBeenLastCalledWith(2, { settled: false });
  act(() => {
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  expect(onSeek).toHaveBeenLastCalledWith(2, { settled: true });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    change(3);
  });
  expect(onSeek).toHaveBeenLastCalledWith(3, { settled: true });
});

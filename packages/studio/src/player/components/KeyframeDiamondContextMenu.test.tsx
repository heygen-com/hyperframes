// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { KeyframeDiamondContextMenu } from "./KeyframeDiamondContextMenu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("KeyframeDiamondContextMenu", () => {
  it("deletes all keyframes from the animation that opened the menu", () => {
    const element: TimelineElement = {
      id: "box",
      tag: "div",
      start: 0,
      duration: 2,
      track: 0,
    };
    const onDeleteAll = vi.fn();
    const root = createRoot(document.createElement("div"));

    act(() => {
      root.render(
        <KeyframeDiamondContextMenu
          state={{
            x: 10,
            y: 10,
            element,
            elementId: "box",
            percentage: 50,
            animationId: "box-scale",
          }}
          onClose={vi.fn()}
          onDelete={vi.fn()}
          onDeleteAll={onDeleteAll}
        />,
      );
    });

    const deleteAll = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete All Keyframes",
    );
    act(() => deleteAll?.click());

    expect(onDeleteAll).toHaveBeenCalledExactlyOnceWith(element, "box-scale");
    act(() => root.unmount());
  });
});

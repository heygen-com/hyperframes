// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField";
import { cleanupMounted, mountHost } from "./mountHost.testHelpers";

afterEach(cleanupMounted);

describe("NumberField composition", () => {
  it.each([
    { name: "an active composition", isComposing: true, keyCode: 13 },
    { name: "Safari's composition confirmation", isComposing: false, keyCode: 229 },
  ])("leaves Enter to $name before committing on a later Enter", ({ isComposing, keyCode }) => {
    const commits: number[] = [];
    const onTrack = vi.fn();
    const host = mountHost(
      <NumberField
        label="Size"
        value={24}
        onCommit={(next) => commits.push(next)}
        onTrack={onTrack}
      />,
    );
    const input = host.querySelector("input")!;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "42");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode,
      which: keyCode,
      isComposing,
      bubbles: true,
      cancelable: true,
    });

    act(() => void input.dispatchEvent(confirmingEnter));

    expect(confirmingEnter.defaultPrevented).toBe(false);
    expect(input.value).toBe("42");
    expect(commits).toEqual([]);
    expect(onTrack).not.toHaveBeenCalled();

    act(
      () =>
        void input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
    );

    expect(commits).toEqual([42]);
    expect(onTrack).toHaveBeenCalledTimes(1);
  });
});

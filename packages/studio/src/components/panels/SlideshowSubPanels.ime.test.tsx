// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchTree } from "./SlideshowSubPanels";
import { cleanupMounted, mountHost } from "../ui/mountHost.testHelpers";

afterEach(cleanupMounted);

function type(input: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(input: HTMLInputElement, init: { isComposing?: boolean; keyCode: number }) {
  act(() => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      isComposing: init.isComposing ?? false,
    });
    Object.defineProperty(event, "keyCode", { value: init.keyCode });
    input.dispatchEvent(event);
  });
}

describe("BranchTree new branch field", () => {
  // Chrome on macOS sends a Korean Enter twice: mid-composition, then after the IME commits the
  // last syllable. Creating on the first cleared the field, the IME typed "기" back in, and the
  // second Enter made a second branch: "분기" became "분기" and "기".
  it("makes one branch from a Korean name ended with Enter", () => {
    const onCreateSequence = vi.fn();
    const host = mountHost(
      <BranchTree
        sequences={[]}
        scenes={[]}
        onCreateSequence={onCreateSequence}
        onRenameSequence={vi.fn()}
        onDeleteSequence={vi.fn()}
        onAssign={vi.fn()}
        selectedSceneId={null}
        selectedSequenceId={null}
        onSelectBranchSlide={vi.fn()}
      />,
    );
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="New branch sequence name"]',
    )!;

    type(input, "분기");
    pressEnter(input, { isComposing: true, keyCode: 229 });
    expect(onCreateSequence).not.toHaveBeenCalled();

    pressEnter(input, { keyCode: 13 });
    expect(onCreateSequence.mock.calls).toEqual([["분기"]]);
    expect(input.value).toBe("");
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { TimelineFxPopover } from "./TimelineFxPopover.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY_CHAIN: HfAudioFxChain = { version: 1, nodes: [] };
const RECT = { left: 0, top: 0, right: 0, bottom: 0 } as DOMRect;

function byTextButton(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

function mount(overrides: Partial<Parameters<typeof TimelineFxPopover>[0]> = {}) {
  const onClose = vi.fn();
  const onChainChange = vi.fn();
  const onChainPreview = vi.fn();
  const onOpenRack = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(
      <TimelineFxPopover
        anchorRect={RECT}
        chain={EMPTY_CHAIN}
        onClose={onClose}
        onChainChange={onChainChange}
        onChainPreview={onChainPreview}
        onOpenRack={onOpenRack}
        {...overrides}
      />,
    );
  });
  return { host, onClose, onChainChange, onChainPreview, onOpenRack };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TimelineFxPopover", () => {
  it("applies a preset with exactly one onChainChange write, and closes", () => {
    const { host, onChainChange, onClose } = mount();
    const button = byTextButton(host, "Chipmunk");
    expect(button).toBeDefined();
    act(() => button?.click());
    expect(onChainChange).toHaveBeenCalledTimes(1);
    const written = onChainChange.mock.calls[0]?.[0] as HfAudioFxChain;
    expect(written.nodes.length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalled();
  });

  it("auditions on hover (focus is the keyboard's hover) and reverts on leave", () => {
    const { host, onChainPreview } = mount();
    const button = byTextButton(host, "Chipmunk");
    expect(button).toBeDefined();
    act(() => (button as HTMLButtonElement).focus());
    expect(onChainPreview).toHaveBeenCalled();
    const previewed = onChainPreview.mock.calls.at(-1)?.[0] as HfAudioFxChain;
    expect(previewed.nodes.length).toBeGreaterThan(0);
    onChainPreview.mockClear();
    act(() => {
      button?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onChainPreview).toHaveBeenCalledWith(EMPTY_CHAIN);
  });

  it("Escape closes without letting the keystroke propagate past the popover", () => {
    const { host, onClose } = mount();
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    act(() => {
      dialog?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", outer);
  });

  it("dismisses on an outside pointerdown", () => {
    const { onClose } = mount();
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not dismiss on a pointerdown inside the popover", () => {
    const { host, onClose } = mount();
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    act(() => {
      dialog?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the footer opens the rack and closes the popover", () => {
    const { host, onOpenRack, onClose } = mount();
    const openRack = byTextButton(host, "Open rack");
    expect(openRack).toBeDefined();
    act(() => openRack?.click());
    expect(onOpenRack).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});

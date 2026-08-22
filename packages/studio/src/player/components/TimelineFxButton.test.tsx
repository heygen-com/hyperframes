// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { serializeAudioFxChain } from "@hyperframes/core/audio-fx";
import { TimelineFxButton } from "./TimelineFxButton.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function byTextButton(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

function mount(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(node));
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TimelineFxButton", () => {
  it("reads FX with no count when the chain is empty", () => {
    const host = mount(
      <TimelineFxButton
        variant="chain"
        fxChainRaw={undefined}
        onChainChange={vi.fn()}
        onOpenRack={vi.fn()}
      />,
    );
    expect(byTextButton(host, "FX")?.textContent).toBe("FX");
  });

  it("counts only enabled nodes", () => {
    const chain = {
      version: 1 as const,
      nodes: [
        { type: "peaking", params: {}, enabled: true },
        { type: "gain", params: {}, enabled: false },
      ],
    };
    const host = mount(
      <TimelineFxButton
        variant="chain"
        fxChainRaw={serializeAudioFxChain(chain)}
        onChainChange={vi.fn()}
        onOpenRack={vi.fn()}
      />,
    );
    expect(byTextButton(host, "FX 1")).toBeDefined();
  });

  it("opens the popover on click, anchored off the button", () => {
    const host = mount(
      <TimelineFxButton
        variant="chain"
        fxChainRaw={undefined}
        onChainChange={vi.fn()}
        onOpenRack={vi.fn()}
      />,
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => byTextButton(host, "FX")?.click());
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  // The reported symptom: clicking FX on an ungrouped audio track "did
  // nothing". The dialog WAS opening — it was positioned at
  // `anchorRect.bottom + 4` with no flip, and the timeline lives at the bottom
  // of the studio window, so it opened past the viewport edge. The old test
  // passed because happy-dom reports an all-zero rect for an unlaid-out button,
  // which lands the dialog at top:4 — on screen, and nothing like the real app.
  it("flips the group dialog above the anchor when it sits at the bottom of the window", () => {
    const host = mount(<TimelineFxButton variant="group-pointer" onGroupClips={vi.fn()} />);
    const fx = byTextButton(host, "FX");
    // A track header near the bottom edge of the (1024x768) window.
    fx!.getBoundingClientRect = () => ({ left: 300, top: 760, right: 320, bottom: 776 }) as DOMRect;
    act(() => fx?.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    // Anchored from the bottom, not pushed off the edge with `top`.
    expect(dialog.style.bottom).toBe("12px");
    expect(dialog.style.top).toBe("");
  });

  it("keeps the group dialog inside the right edge of the window", () => {
    const host = mount(<TimelineFxButton variant="group-pointer" onGroupClips={vi.fn()} />);
    const fx = byTextButton(host, "FX");
    // Anchor hard against the right edge: 224px wide + 8px margin must fit.
    fx!.getBoundingClientRect = () =>
      ({ left: 1010, top: 100, right: 1024, bottom: 116 }) as DOMRect;
    act(() => fx?.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.left).toBe("792px");
  });

  it("group-pointer variant offers Group instead of a popover", () => {
    const onGroupClips = vi.fn();
    const host = mount(<TimelineFxButton variant="group-pointer" onGroupClips={onGroupClips} />);
    act(() => byTextButton(host, "FX")?.click());
    const groupButton = document.body.querySelectorAll("button");
    const group = Array.from(groupButton).find((b) => b.textContent === "Group");
    expect(group).toBeDefined();
    act(() => group?.click());
    expect(onGroupClips).toHaveBeenCalledTimes(1);
  });
});

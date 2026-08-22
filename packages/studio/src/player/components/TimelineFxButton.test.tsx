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

  // The reported symptom was "the grouping button did nothing". The dialog WAS
  // opening — it positioned at `anchorRect.bottom + 4` with no flip and no
  // clamp, and this button lives in a track header at the bottom of the studio
  // window, so it opened past the viewport edge. The test below it passed
  // throughout: happy-dom reports an all-zero rect for an unlaid-out button,
  // which lands the dialog at top:4 — on screen, and nothing like the app.
  it("flips the group dialog above the anchor when there is no room below", () => {
    const host = mount(<TimelineFxButton variant="group-pointer" onGroupClips={vi.fn()} />);
    const fx = byTextButton(host, "FX");
    // A track header near the bottom edge of the (1024x768) window.
    fx!.getBoundingClientRect = () =>
      ({ left: 300, top: 760, right: 320, bottom: 776, width: 20, height: 16 }) as DOMRect;
    act(() => fx?.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    // Above the anchor, and fully inside the viewport: 644 + 112 === 756.
    expect(dialog.style.top).toBe("644px");
  });

  it("keeps the group dialog inside the right edge of the window", () => {
    const host = mount(<TimelineFxButton variant="group-pointer" onGroupClips={vi.fn()} />);
    const fx = byTextButton(host, "FX");
    // Hard against the right edge: 224px wide + a 12px margin has to fit.
    fx!.getBoundingClientRect = () =>
      ({ left: 1010, top: 100, right: 1024, bottom: 116, width: 14, height: 16 }) as DOMRect;
    act(() => fx?.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.left).toBe("788px");
    expect(dialog.style.top).toBe("120px");
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

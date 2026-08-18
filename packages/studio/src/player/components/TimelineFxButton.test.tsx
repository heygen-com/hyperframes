// @vitest-environment happy-dom
import React, { act } from "react";
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

  // A muted target auditions anyway — the mute is lifted on the running graph
  // for the hover and put back on the way out. The read has to happen on the
  // way IN: the live unmute flows back into this component's props, so a
  // restore that re-read `isMuted` would find it false and never re-mute.
  it("borrows a muted target's mute for the audition and returns it", () => {
    const onSetMutedLive = vi.fn();
    const host = mount(
      <TimelineFxButton
        variant="chain"
        fxChainRaw={undefined}
        isMuted
        onSetMutedLive={onSetMutedLive}
        onChainChange={vi.fn()}
        onChainPreview={vi.fn()}
        onOpenRack={vi.fn()}
      />,
    );
    act(() => byTextButton(host, "FX")?.click());
    const preset = document.querySelector<HTMLButtonElement>(".hf-fx-preset-item");
    act(() => preset?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(onSetMutedLive).toHaveBeenLastCalledWith(false);
    const shelf = document.querySelector(".hf-fx-preset-menu");
    act(() => shelf?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(onSetMutedLive).toHaveBeenLastCalledWith(true);
  });

  it("leaves an unmuted target's mute alone", () => {
    const onSetMutedLive = vi.fn();
    const host = mount(
      <TimelineFxButton
        variant="chain"
        fxChainRaw={undefined}
        onSetMutedLive={onSetMutedLive}
        onChainChange={vi.fn()}
        onChainPreview={vi.fn()}
        onOpenRack={vi.fn()}
      />,
    );
    act(() => byTextButton(host, "FX")?.click());
    const preset = document.querySelector<HTMLButtonElement>(".hf-fx-preset-item");
    act(() => preset?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(onSetMutedLive).not.toHaveBeenCalled();
  });

  // Hovering writes the preset through the preview channel, and the chain prop
  // is read back from that same live attribute. Applying while a DIFFERENT
  // preset is being auditioned used to save both — heard as the effect running
  // twice — so the apply has to land on the stored chain.
  it("applies onto the stored chain, not the one being auditioned", () => {
    const onChainChange = vi.fn();
    // The write-back the real timeline does: a preview patches the live
    // attribute, and the row re-reads it into `fxChainRaw`. Without this the
    // prop never moves and the bug cannot show.
    function Harness() {
      const [raw, setRaw] = React.useState<string | undefined>(undefined);
      return (
        <TimelineFxButton
          variant="chain"
          fxChainRaw={raw}
          onChainChange={onChainChange}
          onChainPreview={(next) => setRaw(serializeAudioFxChain(next))}
          onOpenRack={vi.fn()}
        />
      );
    }
    const host = mount(<Harness />);
    act(() => byTextButton(host, "FX")?.click());
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>(".hf-fx-preset-item"));
    const [hovered, clicked] = [items[0], items[1]];
    act(() => hovered?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => clicked?.click());
    const saved = onChainChange.mock.calls.at(-1)?.[0];
    const presets = new Set(saved?.nodes.map((n: { fromPreset?: string }) => n.fromPreset));
    expect(presets.size).toBe(1);
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

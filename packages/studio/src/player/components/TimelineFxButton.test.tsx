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

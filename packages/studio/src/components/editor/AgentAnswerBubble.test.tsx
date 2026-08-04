// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentAnswerBubble, resolveBubblePosition } from "./AgentAnswerBubble";
import type { AgentJob } from "./agentGlyphs";
import type { OverlayRect } from "./domEditOverlayGeometry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

function rect(partial: Partial<OverlayRect> = {}): OverlayRect {
  return { left: 100, top: 100, width: 200, height: 80, editScaleX: 1, editScaleY: 1, ...partial };
}

function job(partial: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    kind: "claude",
    label: "Claude Code",
    target: "Title",
    instruction: "why is this off-centre?",
    status: "done",
    activity: "",
    message: "It is not centred: the parent is a flex row with justify-content: flex-start.",
    startedAt: Date.now() - 2000,
    endedAt: Date.now(),
    ...partial,
  };
}

function renderBubble(overrides: Partial<Parameters<typeof AgentAnswerBubble>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <AgentAnswerBubble
        job={job()}
        rect={rect()}
        canvas={{ width: 800, height: 600 }}
        agentIconUrl={null}
        onDismiss={vi.fn()}
        onFollowUp={vi.fn()}
        {...overrides}
      />,
    );
  });
  return { host, root };
}

describe("resolveBubblePosition", () => {
  it("speaks from below the element, centred on it", () => {
    const { style, side } = resolveBubblePosition(rect(), { width: 800, height: 600 }, 108);
    expect(side).toBe("below");
    // 100 + 100 - 134
    expect(style.left).toBe(66);
    expect(style.top).toBe(190);
  });

  it("flips above when there is no room underneath", () => {
    const { side } = resolveBubblePosition(rect({ top: 520 }), { width: 800, height: 600 }, 108);
    expect(side).toBe("above");
  });

  it("keeps the tail on the element even when the bubble is pushed off it", () => {
    const canvas = { width: 800, height: 600 };
    // Centred: the tail sits in the middle of the bubble.
    expect(resolveBubblePosition(rect(), canvas, 108).tailLeft).toBe(134);

    // Against the left edge the bubble stops moving but the element keeps going,
    // so the tail slides toward that edge to stay under it.
    const nearEdge = resolveBubblePosition(rect({ left: 0, width: 60 }), canvas, 108);
    expect(nearEdge.style.left).toBe(10);
    expect(nearEdge.tailLeft).toBe(20);

    // And never past the bubble's own rounded corner.
    const offCanvas = resolveBubblePosition(rect({ left: -400, width: 40 }), canvas, 108);
    expect(offCanvas.tailLeft).toBe(14);
  });
});

describe("AgentAnswerBubble", () => {
  it("says what the agent answered, pointing at it", () => {
    const { host, root } = renderBubble();
    expect(host.textContent).toContain("justify-content: flex-start");
    expect(host.querySelector<HTMLElement>("[data-agent-answer-tail]")?.style.left).toBe("134px");
    act(() => root.unmount());
  });

  it("stays quiet when the run left no message", () => {
    const { host, root } = renderBubble({ job: job({ message: undefined }) });
    expect(host.querySelector("[data-agent-answer-bubble]")).toBeNull();
    act(() => root.unmount());
  });

  it("can be dismissed, and can carry straight into a follow-up", () => {
    const onDismiss = vi.fn();
    const onFollowUp = vi.fn();
    const { host, root } = renderBubble({ onDismiss, onFollowUp });

    const dismiss = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Dismiss this answer",
    );
    act(() => dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const again = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ask again");
    act(() => again?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("colours a failure differently from an answer", () => {
    const { host, root } = renderBubble({
      job: job({ status: "failed", message: "Codex exited with code 1" }),
    });
    expect(host.querySelector("p")?.className).toContain("text-red-300");
    act(() => root.unmount());
  });
});

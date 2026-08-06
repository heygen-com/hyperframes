// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPermissionPrompt } from "./AgentPermissionPrompt";
import type { AgentJob } from "./agentGlyphs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const OPTIONS = [
  { optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const },
  { optionId: "reject_once", name: "Reject", kind: "reject_once" as const },
];

function job(partial: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    kind: "codex",
    label: "Codex",
    target: "Chip",
    instruction: "make the title red",
    status: "awaiting-permission",
    activity: "Waiting on you · Write composition.html",
    permission: { tool: "Write composition.html", options: OPTIONS },
    startedAt: Date.now() - 4000,
    ...partial,
  };
}

function render(agentJob: AgentJob, onAnswer = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<AgentPermissionPrompt job={agentJob} onAnswer={onAnswer} />);
  });
  return { host, root, onAnswer };
}

function optionButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")];
}

describe("AgentPermissionPrompt", () => {
  // The labels are the agent's, not Studio's: writing our own would describe a
  // choice the agent is not offering.
  it("offers one button per option, in the agent's own words", () => {
    const { host, root } = render(job());

    expect(optionButtons(host).map((b) => b.textContent)).toEqual(["Allow Once", "Reject"]);
    expect(host.textContent).toContain("Codex");
    expect(host.textContent).toContain("Write composition.html");
    act(() => root.unmount());
  });

  it("answers once, with the id behind the label that was clicked", () => {
    const { host, root, onAnswer } = render(job());

    act(() => {
      optionButtons(host)[1]!.click();
    });

    expect(onAnswer.mock.calls).toEqual([["job-1", "reject_once"]]);
    act(() => root.unmount());
  });

  it("shows nothing for a run that is not waiting on anything", () => {
    const { host, root } = render(job({ status: "running", permission: undefined }));
    expect(host.textContent).toBe("");
    act(() => root.unmount());
  });

  // A run that says it is waiting but carries no question is a bug somewhere
  // else; showing a prompt with no way to answer would strand it here.
  it("shows nothing when the question did not survive", () => {
    const { host, root } = render(job({ permission: undefined }));
    expect(host.textContent).toBe("");
    act(() => root.unmount());
  });

  it("gives every option a name a screen reader can read", () => {
    const { host, root } = render(job());

    for (const button of optionButtons(host)) {
      expect(button.textContent?.trim()).toBeTruthy();
      // Real buttons, so tab order and Enter come for free.
      expect(button.tagName).toBe("BUTTON");
      expect(button.disabled).toBe(false);
    }
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Codex is asking to Write composition.html",
    );
    act(() => root.unmount());
  });
});

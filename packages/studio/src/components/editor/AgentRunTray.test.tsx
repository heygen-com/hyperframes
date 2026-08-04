// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunTray } from "./AgentRunTray";
import { ownsPreviewPanTarget } from "../nle/previewZoom";
import type { AgentJob } from "./agentGlyphs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function job(partial: Partial<AgentJob>): AgentJob {
  return {
    id: "job-1",
    kind: "claude",
    label: "Claude Code",
    target: "Chip",
    instruction: "make the title red",
    status: "running",
    activity: "",
    startedAt: Date.now() - 4000,
    ...partial,
  };
}

function renderTray(
  jobs: AgentJob[],
  onClearFinished = vi.fn(),
  agentIconUrl: string | null = null,
  handlers: {
    onMoveJob?: (id: string, position: number) => void;
    onCancelJob?: (id: string) => void;
    onRevealTarget?: (job: AgentJob) => void;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <AgentRunTray
        jobs={jobs}
        agentIconUrl={agentIconUrl}
        onClearFinished={onClearFinished}
        {...handlers}
      />,
    );
  });
  return { host, root, onClearFinished };
}

function buttonLabelled(host: HTMLElement, label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === label);
}

describe("AgentRunTray", () => {
  it("renders nothing without runs", () => {
    const { host, root } = renderTray([]);
    expect(host.textContent).toBe("");
    act(() => root.unmount());
  });

  it("shows what the agent is doing right now", () => {
    const { host, root } = renderTray([job({ activity: "Edit · index.html" })]);
    expect(host.textContent).toContain("1 running");
    expect(host.textContent).toContain("make the title red");
    expect(host.textContent).toContain("Edit · index.html");
    act(() => root.unmount());
  });

  it("counts only in-flight runs and reports queue position", () => {
    const { host, root } = renderTray([
      job({ id: "a", status: "running", activity: "Read · index.html" }),
      job({ id: "b", status: "queued", instruction: "round the card" }),
      job({ id: "c", status: "done", message: "Claude Code finished.", endedAt: Date.now() }),
    ]);
    expect(host.textContent).toContain("2 running");
    expect(host.textContent).toContain("Queued");
    expect(host.textContent).toContain("Claude Code finished.");
    act(() => root.unmount());
  });

  it("offers Clear only once a run has finished", () => {
    const running = renderTray([job({})]);
    expect(running.host.textContent).not.toContain("Clear");
    act(() => running.root.unmount());

    const { host, root, onClearFinished } = renderTray([
      job({ status: "failed", message: "Agent exited with code 1", endedAt: Date.now() }),
    ]);
    expect(host.textContent).toContain("Agent exited with code 1");
    const clear = [...host.querySelectorAll("button")].find((b) => b.textContent === "Clear");
    act(() => clear?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClearFinished).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("collapses the list but keeps the summary", () => {
    const { host, root } = renderTray([job({})]);
    const toggle = host.querySelector("button");
    act(() => toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("1 running");
    expect(host.querySelector("ul")).toBeNull();
    act(() => root.unmount());
  });
});

describe("queue editing", () => {
  it("moves a waiting run toward the front of the queue", () => {
    const onMoveJob = vi.fn();
    // Newest-first rows: "third" is the last in line, "second" ahead of it.
    const { host, root } = renderTray(
      [
        job({ id: "third", status: "queued", instruction: "third" }),
        job({ id: "second", status: "queued", instruction: "second" }),
        job({ id: "first", status: "running", instruction: "first" }),
      ],
      vi.fn(),
      null,
      { onMoveJob },
    );

    const [thirdSooner, secondSooner] = buttonLabelled(host, "Run sooner");
    // "second" is already next up, so it cannot move any sooner.
    expect(secondSooner?.disabled).toBe(true);
    act(() => thirdSooner?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onMoveJob).toHaveBeenCalledWith("third", 0);
    act(() => root.unmount());
  });

  it("removes a queued run and stops a running one", () => {
    const onCancelJob = vi.fn();
    const { host, root } = renderTray(
      [job({ id: "waiting", status: "queued" }), job({ id: "going", status: "running" })],
      vi.fn(),
      null,
      { onCancelJob },
    );

    expect(buttonLabelled(host, "Remove from queue")).toHaveLength(1);
    const [stop] = buttonLabelled(host, "Stop this run");
    act(() => stop?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onCancelJob).toHaveBeenCalledWith("going");
    act(() => root.unmount());
  });

  it("offers no queue controls on finished runs", () => {
    const { host, root } = renderTray(
      [job({ status: "done", endedAt: Date.now() })],
      vi.fn(),
      null,
      { onMoveJob: vi.fn(), onCancelJob: vi.fn() },
    );
    expect(buttonLabelled(host, "Stop this run")).toHaveLength(0);
    expect(buttonLabelled(host, "Run sooner")).toHaveLength(0);
    act(() => root.unmount());
  });
});

describe("run detail", () => {
  it("stacks one mark per harness used", () => {
    const { host, root } = renderTray([
      job({ id: "a", kind: "claude" }),
      job({ id: "b", kind: "codex" }),
      job({ id: "c", kind: "claude" }),
    ]);
    const header = host.querySelector("[data-agent-run-tray]")?.firstElementChild;
    // Two harnesses, two marks — the repeat does not add a third.
    expect(header?.querySelectorAll("svg").length).toBe(3); // chevron + 2 marks
    act(() => root.unmount());
  });

  it("shows a short session id and reveals the edited element", () => {
    const onRevealTarget = vi.fn();
    const target = job({
      status: "done",
      endedAt: Date.now(),
      sessionId: "9acb64fb-287e-4c45-b766-9d2e0597ddda",
      targetRef: { selector: "#chip", time: 1.5 },
    });
    const { host, root } = renderTray([target], vi.fn(), null, { onRevealTarget });

    expect(host.textContent).toContain("9acb64fb");
    expect(host.textContent).not.toContain("287e-4c45");
    const reveal = [...host.querySelectorAll("button")].find((b) => b.textContent === "Chip");
    act(() => reveal?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRevealTarget).toHaveBeenCalledWith(target);
    act(() => root.unmount());
  });

  it("marks its list as owning its own wheel, so the canvas leaves it alone", () => {
    const { host, root } = renderTray([job({}), job({ id: "b" })]);
    const list = host.querySelector("ul");
    expect(list?.getAttribute("data-preview-overlay-scroll")).toBe("true");
    expect(list?.className).toContain("overscroll-contain");
    // The canvas asks ownsPreviewPanTarget before panning; see previewZoom.
    expect(ownsPreviewPanTarget(list, null)).toBe(false);
    act(() => root.unmount());
  });
});

describe("harness marks", () => {
  it("draws a distinct glyph per harness and prefers a supplied icon", () => {
    const kinds: AgentJob["kind"][] = ["claude", "codex", "hermes", "openclaw", "custom"];
    const { host, root } = renderTray(
      kinds.map((kind, index) => job({ id: `job-${index}`, kind, label: kind })),
    );
    // Every harness draws its own vendor mark: distinct viewBoxes for the SVG
    // ones (Claude 248, OpenAI 24, OpenClaw 120, spark 16) and Hermes' own
    // caduceus glyph, which its favicon ships as type rather than a path.
    const viewBoxes = new Set(
      [...host.querySelectorAll("li svg")].map((svg) => svg.getAttribute("viewBox")),
    );
    expect(viewBoxes).toEqual(new Set(["0 0 248 248", "0 0 24 24", "0 0 120 120", "0 0 16 16"]));
    expect(host.textContent).toContain("⚕");
    act(() => root.unmount());

    const withIcon = renderTray([job({})], vi.fn(), "/api/projects/p1/agent/icon");
    expect(withIcon.host.querySelector("img")?.getAttribute("src")).toBe(
      "/api/projects/p1/agent/icon",
    );
    act(() => withIcon.root.unmount());
  });
});

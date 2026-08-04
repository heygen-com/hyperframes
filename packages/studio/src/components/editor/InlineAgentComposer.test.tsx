// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineAgentComposer, resolveComposerPosition } from "./InlineAgentComposer";
import type { OverlayRect } from "./domEditOverlayGeometry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function rect(partial: Partial<OverlayRect>): OverlayRect {
  return { left: 0, top: 0, width: 100, height: 40, editScaleX: 1, editScaleY: 1, ...partial };
}

function renderComposer(overrides: Partial<Parameters<typeof InlineAgentComposer>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <InlineAgentComposer
        selectionLabel="#title"
        rect={rect({})}
        canvas={{ width: 800, height: 600 }}
        runLabel="Claude Code"
        agentKind="claude"
        agentIconUrl={null}
        onRun={vi.fn()}
        onCopy={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />,
    );
  });
  return { host, root };
}

function type(host: HTMLElement, value: string) {
  const textarea = host.querySelector("textarea");
  act(() => {
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        value,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function pressEnter(host: HTMLElement) {
  act(() => {
    host
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const CANVAS = { width: 800, height: 600 };

describe("resolveComposerPosition", () => {
  it("centers under the selection", () => {
    expect(resolveComposerPosition(rect({ left: 300, top: 100, width: 200 }), CANVAS, 84)).toEqual({
      left: 240, // 300 + 100 - 160
      top: 150, // 100 + 40 + 10
    });
  });

  it("flips above when the composer would fall off the bottom", () => {
    expect(resolveComposerPosition(rect({ top: 540 }), CANVAS, 84).top).toBe(446); // 540 - 84 - 10
  });

  it("clamps horizontally inside the canvas", () => {
    expect(resolveComposerPosition(rect({ left: 780 }), CANVAS, 84).left).toBe(470);
    expect(resolveComposerPosition(rect({ left: -200 }), CANVAS, 84).left).toBe(10);
  });

  it("pins to the bottom when the element has no rect", () => {
    expect(resolveComposerPosition(null, CANVAS, 84)).toEqual({ left: 240, bottom: 10 });
  });
});

const AGENTS = [
  { id: "claude", kind: "claude" as const, label: "Claude Code", available: true },
  { id: "codex", kind: "codex" as const, label: "Codex", available: true },
  { id: "hermes", kind: "hermes" as const, label: "Hermes", available: false },
];

describe("harness picker", () => {
  it("switches the harness a run will use", () => {
    const onSelectAgent = vi.fn();
    const { host, root } = renderComposer({ agentOptions: AGENTS, onSelectAgent });

    const header = host.querySelector("button");
    act(() => header?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const codex = [...host.querySelectorAll("li button")].find((b) =>
      b.textContent?.includes("Codex"),
    );
    act(() => codex?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onSelectAgent).toHaveBeenCalledWith("codex");
    // Picking closes the menu again.
    expect(host.querySelectorAll("li button")).toHaveLength(0);
    act(() => root.unmount());
  });

  it("greys out a harness that is not installed", () => {
    const { host, root } = renderComposer({ agentOptions: AGENTS, onSelectAgent: vi.fn() });
    act(() =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const hermes = [...host.querySelectorAll("li button")].find((b) =>
      b.textContent?.includes("Hermes"),
    ) as HTMLButtonElement | undefined;
    expect(hermes?.disabled).toBe(true);
    act(() => root.unmount());
  });

  it("still opens with one harness, so another can be added", () => {
    const onAddCustomAgent = vi.fn();
    const { host, root } = renderComposer({
      agentOptions: [AGENTS[0]!],
      onSelectAgent: vi.fn(),
      onAddCustomAgent,
    });
    act(() =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(host.textContent).toContain("Add a harness…");
    act(() => root.unmount());
  });

  it("registers a harness of your own from the picker", async () => {
    const onAddCustomAgent = vi.fn().mockResolvedValue(true);
    const { host, root } = renderComposer({
      agentOptions: AGENTS,
      onSelectAgent: vi.fn(),
      onAddCustomAgent,
    });
    act(() =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const addRow = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add a harness"),
    );
    act(() => addRow?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const fields = [...host.querySelectorAll("[data-custom-agent-form] input")];
    const setValue = (input: Element, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => {
      setValue(fields[0]!, "Pi");
      setValue(fields[1]!, "pi");
      setValue(fields[2]!, "--headless run");
      setValue(fields[4]!, "--model");
    });
    const submit = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Add harness",
    );
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAddCustomAgent).toHaveBeenCalledWith({
      label: "Pi",
      command: "pi",
      args: ["--headless", "run"],
      icon: undefined,
      modelFlag: "--model",
    });
    act(() => root.unmount());
  });

  it("puts the model beside the harness, not inside its menu", () => {
    const onSelectModel = vi.fn();
    const { host, root } = renderComposer({
      agentOptions: AGENTS,
      onSelectAgent: vi.fn(),
      onSelectModel,
      agentModels: [
        { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", inputCost: 1, outputCost: 5 },
        { id: "claude-opus-4-6", name: "Claude Opus 4.6", inputCost: 15, outputCost: 75 },
      ],
      selectedModel: "claude-haiku-4-5",
    });

    const header = host.querySelector("[data-inline-agent-composer]")?.firstElementChild;
    expect(header?.textContent).toContain("claude-haiku-4-5");

    const modelChip = [...(header?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("claude-haiku-4-5"),
    );
    act(() => modelChip?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const opus = [...host.querySelectorAll("li button")].find((b) =>
      b.textContent?.includes("Claude Opus"),
    );
    act(() => opus?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectModel).toHaveBeenCalledWith("claude-opus-4-6");
    act(() => root.unmount());
  });
});

describe("InlineAgentComposer", () => {
  it("queues the run on Enter and clears the field for the next one", () => {
    const onRun = vi.fn();
    const { host, root } = renderComposer({ onRun });

    type(host, "  make the title red  ");
    pressEnter(host);
    expect(onRun).toHaveBeenCalledWith("make the title red");
    expect(host.querySelector("textarea")?.value).toBe("");

    type(host, "now round the corners");
    pressEnter(host);
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun).toHaveBeenLastCalledWith("now round the corners");
    act(() => root.unmount());
  });

  it("copies instead of running when no agent CLI is installed", () => {
    const onCopy = vi.fn();
    const onRun = vi.fn();
    const { host, root } = renderComposer({ runLabel: null, onCopy, onRun });

    type(host, "make it pop");
    pressEnter(host);
    expect(onCopy).toHaveBeenCalledWith("make it pop");
    expect(onRun).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("names the harness in the header and the element in the field", () => {
    const { host, root } = renderComposer({ selectionLabel: "Card" });
    const header = host.querySelector<HTMLElement>(
      "[data-inline-agent-composer]",
    )?.firstElementChild;
    expect(header?.textContent).toContain("Claude Code");
    expect(header?.textContent).not.toContain("Card");
    expect(host.querySelector("textarea")?.placeholder).toBe("Describe a change to Card…");
    act(() => root.unmount());
  });

  it("falls back to the element name when no harness is installed", () => {
    const { host, root } = renderComposer({ runLabel: null, selectionLabel: "Card" });
    expect(
      host.querySelector("[data-inline-agent-composer]")?.firstElementChild?.textContent,
    ).toContain("Card");
    act(() => root.unmount());
  });

  it("shows the harness mark and drags from the header", () => {
    const { host, root } = renderComposer({ agentKind: "claude" });
    const composer = host.querySelector<HTMLElement>("[data-inline-agent-composer]");
    expect(composer?.querySelector('svg[fill="#d97757"]')).toBeTruthy();

    const header = composer?.firstElementChild as HTMLElement;
    header.setPointerCapture = vi.fn();
    header.releasePointerCapture = vi.fn();
    act(() => {
      header.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, button: 0 }),
      );
      header.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 140, clientY: 130 }),
      );
    });

    expect(composer?.style.translate).toBe("40px 30px");
    act(() => root.unmount());
  });

  it("closes on Escape without bubbling the key to canvas hotkeys", () => {
    const onClose = vi.fn();
    const { host, root } = renderComposer({ onClose });
    const bubbled = vi.fn();
    document.addEventListener("keydown", bubbled);
    act(() => {
      host
        .querySelector("textarea")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    document.removeEventListener("keydown", bubbled);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bubbled).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("canvas stacking", () => {
  it("draws above the overlay's own decorations", () => {
    // The motion path and its keyframe nodes sit at z-40 and used to cross
    // straight through both the composer and the ask handle.
    const { host, root } = renderComposer({});
    expect(host.querySelector("[data-inline-agent-composer]")?.className).toContain("z-50");
    act(() => root.unmount());
  });
});

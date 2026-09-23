// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupMounted, mountHost } from "./ui/mountHost.testHelpers";
import { isTypingTarget } from "../utils/typingTarget";
import { shouldIgnorePlaybackShortcutTarget } from "../player/lib/playbackShortcuts";

const editHistory = {
  canUndo: false,
  canRedo: false,
  undoLabel: undefined as string | undefined,
  redoLabel: undefined as string | undefined,
};
const handleUndo = vi.fn();
const handleRedo = vi.fn();
const trackStudioEvent = vi.fn();

vi.mock("../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ editHistory, handleUndo, handleRedo }),
}));
vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent }));

const { TimelineHistoryButtons } = await import("./TimelineHistoryButtons");
const { TimelineToolbar } = await import("./TimelineToolbar");

beforeEach(() => {
  Object.assign(editHistory, {
    canUndo: false,
    canRedo: false,
    undoLabel: undefined,
    redoLabel: undefined,
  });
  vi.clearAllMocks();
});

afterEach(cleanupMounted);

const mount = mountHost;

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`not rendered: ${label}`);
  return el;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

it("calls handleUndo once and tracks the event when Undo is enabled", () => {
  editHistory.canUndo = true;
  const host = mount(<TimelineHistoryButtons />);

  click(button(host, "Undo"));

  expect(handleUndo).toHaveBeenCalledTimes(1);
  expect(handleRedo).not.toHaveBeenCalled();
  expect(trackStudioEvent).toHaveBeenCalledWith("toolbar_action", { action: "undo" });
});

it("calls handleRedo once and tracks the event when Redo is enabled", () => {
  editHistory.canRedo = true;
  const host = mount(<TimelineHistoryButtons />);

  click(button(host, "Redo"));

  expect(handleRedo).toHaveBeenCalledTimes(1);
  expect(trackStudioEvent).toHaveBeenCalledWith("toolbar_action", { action: "redo" });
});

it("disables both buttons and ignores clicks on an empty history", () => {
  const host = mount(<TimelineHistoryButtons />);

  for (const label of ["Undo", "Redo"]) {
    const el = button(host, label);
    expect(el.disabled).toBe(true);
    expect(el.className).toContain("cursor-not-allowed");
    click(el);
  }
  expect(handleUndo).not.toHaveBeenCalled();
  expect(handleRedo).not.toHaveBeenCalled();
  expect(trackStudioEvent).not.toHaveBeenCalled();
});

it("leaves enabled buttons without the disabled attribute", () => {
  editHistory.canUndo = true;
  const el = button(mount(<TimelineHistoryButtons />), "Undo");

  expect(el.disabled).toBe(false);
  expect(el.className).not.toContain("cursor-not-allowed");
});

it("orders the toolbar Undo, Redo, Select, Razor", () => {
  const host = mount(<TimelineToolbar />);
  const labels = Array.from(host.querySelectorAll("button"))
    .map((b) => b.getAttribute("aria-label"))
    .filter((l) => l !== null)
    .slice(0, 4);

  expect(labels).toEqual(["Undo", "Redo", "Selection tool", "Razor tool"]);
});

it("classifies Undo and Redo for the hotkey filters at their new location (KTD13)", () => {
  // The header's own version of this check dropped Undo/Redo when they moved
  // here; a <button> is never a typing target and is always claimed by the
  // playback filter, same as every other toolbar tool.
  const host = mount(<TimelineHistoryButtons />);

  for (const label of ["Undo", "Redo"]) {
    const el = button(host, label);
    expect(isTypingTarget(el), label).toBe(false);
    expect(shouldIgnorePlaybackShortcutTarget(el), label).toBe(true);
  }
});

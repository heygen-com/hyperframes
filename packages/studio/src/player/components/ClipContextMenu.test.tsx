// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { ClipContextMenu } from "./ClipContextMenu";
import type { TimelineClipMenuItem } from "./TimelineTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const element = {
  id: "title",
  tag: "div",
  start: 0,
  duration: 2,
  track: 0,
} as unknown as TimelineElement;

function renderMenu(hostItems: readonly TimelineClipMenuItem[], onClose = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <ClipContextMenu
        x={10}
        y={10}
        element={element}
        currentTime={1}
        onClose={onClose}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={() => true}
        hostItems={hostItems}
      />,
    ),
  );
  const items = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
  return { items, unmount: () => act(() => root.unmount()) };
}

describe("ClipContextMenu host items", () => {
  it("lists the host's items first and closes the menu before one acts", () => {
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push("close"));
    const { items, unmount } = renderMenu(
      [
        {
          id: "ask",
          label: "Ask",
          icon: <svg data-testid="ask-icon" />,
          shortcut: "A",
          onSelect: () => calls.push("ask"),
        },
      ],
      onClose,
    );
    expect(items().map((item) => item.textContent)).toEqual(["AskA", "Copy⌘C", "Delete⌫"]);
    expect(items()[0]!.querySelector("[data-testid=ask-icon]")).not.toBeNull();
    act(() => items()[0]!.click());
    expect(calls).toEqual(["close", "ask"]);
    unmount();
  });

  it("keeps a disabled host item inert", () => {
    const onSelect = vi.fn();
    const { items, unmount } = renderMenu([{ id: "ask", label: "Ask", disabled: true, onSelect }]);
    expect(items()[0]!.disabled).toBe(true);
    act(() => items()[0]!.click());
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
  });

  it("shows only Studio's items when the host adds none", () => {
    const { items, unmount } = renderMenu([]);
    expect(items().map((item) => item.textContent)).toEqual(["Copy⌘C", "Delete⌫"]);
    expect(document.body.querySelectorAll(".border-t")).toHaveLength(1);
    unmount();
  });
});

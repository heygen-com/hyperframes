// @vitest-environment happy-dom
import { act, StrictMode, useRef, useState } from "react";
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
  it("lists the host's items first, with their icon and shortcut, and closes on a pick", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { items, unmount } = renderMenu(
      [{ id: "ask", label: "Ask", icon: <svg data-testid="ask-icon" />, shortcut: "A", onSelect }],
      onClose,
    );
    expect(items().map((item) => item.textContent)).toEqual(["AskA", "Copy⌘C", "Delete⌫"]);
    expect(items()[0]!.querySelector("[data-testid=ask-icon]")).not.toBeNull();
    act(() => items()[0]!.click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
  });

  it("counts host rows and their divider when keeping the menu inside the window", () => {
    const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const ask = { label: "Ask", onSelect: vi.fn() };
      act(() =>
        root.render(
          <ClipContextMenu
            x={10}
            y={550}
            element={element}
            currentTime={1}
            onClose={vi.fn()}
            onSplit={vi.fn()}
            onDelete={vi.fn()}
            onCopy={() => true}
            hostItems={[
              { id: "a", ...ask },
              { id: "b", ...ask },
            ]}
          />,
        ),
      );
      // Four 30 px rows, two 9 px dividers and 8 px of padding end 96 px below the window.
      expect(document.body.querySelector<HTMLElement>("[role=menu]")!.style.top).toBe("446px");
      act(() => root.unmount());
    } finally {
      if (innerHeight) Object.defineProperty(window, "innerHeight", innerHeight);
    }
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

/** A clip button that opens the real menu, whose Ask moves the focus the way `focus` says. */
function FocusHost({ focus }: { focus: "existing" | "mounted" }) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const existing = useRef<HTMLInputElement>(null);
  const ask = () => (focus === "existing" ? existing.current!.focus() : setAsked(true));
  return (
    <>
      <button type="button" data-testid="clip" onClick={() => setOpen(true)} />
      <input ref={existing} data-testid="existing" />
      {asked && <input data-testid="mounted" autoFocus />}
      {open && (
        <ClipContextMenu
          x={10}
          y={10}
          element={element}
          currentTime={1}
          onClose={() => setOpen(false)}
          onSplit={vi.fn()}
          onDelete={vi.fn()}
          hostItems={[{ id: "ask", label: "Ask", onSelect: ask }]}
        />
      )}
    </>
  );
}

function openFrom(focus: "existing" | "mounted") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  // StrictMode runs the menu's effect cleanup once while it is still mounted, as Studio's dev build does.
  act(() =>
    root.render(
      <StrictMode>
        <FocusHost focus={focus} />
      </StrictMode>,
    ),
  );
  const clip = document.body.querySelector<HTMLButtonElement>("[data-testid=clip]")!;
  clip.focus();
  act(() => clip.click());
  const menuItem = () => document.body.querySelector<HTMLButtonElement>("[role=menuitem]");
  expect(document.activeElement).toBe(menuItem());
  return { menuItem, unmount: () => act(() => root.unmount()) };
}

const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.testid;

describe("ClipContextMenu focus on close", () => {
  it.each(["existing", "mounted"] as const)(
    "leaves the focus where a host item put it (%s field)",
    (focus) => {
      const { menuItem, unmount } = openFrom(focus);
      act(() => menuItem()!.click());
      expect(menuItem()).toBeNull();
      expect(focusedId()).toBe(focus);
      unmount();
    },
  );

  it("gives the focus back to the clip when the menu closes without moving it", () => {
    const { menuItem, unmount } = openFrom("existing");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(menuItem()).toBeNull();
    expect(focusedId()).toBe("clip");
    unmount();
  });
});

// @vitest-environment jsdom
import { act, createElement, Profiler, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useTimelineShiftModifier } from "./useTimelineShiftModifier";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Timeline() {
  const container = useRef<HTMLDivElement>(null);
  useTimelineShiftModifier(container);
  return createElement("div", { ref: container, "data-testid": "timeline" });
}

const key = (type: string, name: string) =>
  act(() => void window.dispatchEvent(new KeyboardEvent(type, { key: name })));

it("Shift marks the timeline for its cursor without rendering it", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let commits = 0;
  act(() =>
    root.render(
      createElement(Profiler, { id: "t", onRender: () => (commits += 1) }, createElement(Timeline)),
    ),
  );
  const timeline = host.querySelector("[data-testid=timeline]")!;
  const start = commits;
  key("keydown", "Shift");
  expect(timeline.hasAttribute("data-shift-held")).toBe(true);
  key("keydown", "a");
  expect(timeline.hasAttribute("data-shift-held")).toBe(true);
  key("keyup", "Shift");
  expect(timeline.hasAttribute("data-shift-held")).toBe(false);
  key("keydown", "Shift");
  act(() => void window.dispatchEvent(new Event("blur")));
  expect(timeline.hasAttribute("data-shift-held")).toBe(false);
  expect(commits).toBe(start);
  act(() => root.unmount());
});

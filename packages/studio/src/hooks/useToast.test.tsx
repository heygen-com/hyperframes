// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useToast } from "./useToast";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.useRealTimers());

it("an info toast with an action stays until it is used or dismissed", async () => {
  vi.useFakeTimers();
  let toast!: ReturnType<typeof useToast>;
  function Probe() {
    toast = useToast();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  act(() => {
    toast.showToast("Saved", "info");
    toast.showToast("Can't undo", "info", { label: "Undo Agent turn", run: () => {} });
  });
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(toast.toasts.map((item) => item.message)).toEqual(["Can't undo"]);
  act(() => root.unmount());
});

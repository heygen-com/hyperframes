// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useInspectorGestureTransaction } from "./useInspectorGestureTransaction";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useInspectorGestureTransaction", () => {
  it("keeps a new gesture active when the prior async commit is acknowledged", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    let gesture: ReturnType<typeof useInspectorGestureTransaction<number>> | null = null;

    function Probe({ sourceValue }: { sourceValue: number }) {
      gesture = useInspectorGestureTransaction({ sourceValue, onPreview, onCommit });
      return null;
    }

    act(() => root.render(<Probe sourceValue={10} />));
    act(() => {
      gesture?.preview(20);
      gesture?.settle();
      gesture?.preview(30);
    });
    act(() => root.render(<Probe sourceValue={20} />));

    expect(onPreview).toHaveBeenLastCalledWith(30);
    act(() => gesture?.settle());
    expect(onCommit.mock.calls.map(([value]) => value)).toEqual([20, 30]);

    act(() => root.unmount());
  });
});

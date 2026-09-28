// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MockResizeObserver, reportResize } from "./resizeObserverTestUtils";
import { useThumbnailStripSize } from "./useThumbnailStripSize";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("does not re-render the strip when the observer reports the size it already holds", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  const host = document.createElement("div");
  document.body.append(host);
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 300 });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: 40 });
  const root = createRoot(host);
  let stripRenders = 0;
  function Strip({ label }: { label: string }) {
    stripRenders += 1;
    return label;
  }
  function Harness() {
    const [size, ref] = useThumbnailStripSize();
    return (
      <div ref={ref}>
        <Strip label={`${size.width}x${size.height}`} />
      </div>
    );
  }
  try {
    act(() => root.render(<Harness />));
    expect(host.textContent).toBe("300x40");
    const settled = stripRenders;

    act(() => reportResize(300, 40));
    expect(stripRenders).toBe(settled);

    act(() => reportResize(320, 40));
    expect(stripRenders).toBe(settled + 1);
    expect(host.textContent).toBe("320x40");
  } finally {
    act(() => root.unmount());
    host.remove();
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

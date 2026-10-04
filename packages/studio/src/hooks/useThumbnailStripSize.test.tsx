// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NearScreenIntersectionObserver } from "./intersectionObserverTestUtils";
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

it("re-measures every strip in one shared frame on a scroll, so a full timeline lays out once", async () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver =
    NearScreenIntersectionObserver as unknown as typeof IntersectionObserver;
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  const frames: FrameRequestCallback[] = [];
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((frame) => frames.push(frame));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let left = 0;
  const rect = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({ left }) as DOMRect);
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1_000_000);
  function Strip() {
    const [size, ref] = useThumbnailStripSize();
    return (
      <div>
        <div ref={ref} data-in-view-start={size.inViewStart} />
      </div>
    );
  }
  try {
    await act(async () =>
      root.render(Array.from({ length: 50 }, (_, index) => <Strip key={index} />)),
    );

    left = -10_000;
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(requestFrame).toHaveBeenCalledTimes(1);
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    const starts = [...host.querySelectorAll("[data-in-view-start]")].map((strip) =>
      strip.getAttribute("data-in-view-start"),
    );
    expect(starts).toEqual(Array(50).fill("9216"));
  } finally {
    rect.mockRestore();
    width.mockRestore();
    act(() => root.unmount());
    host.remove();
    requestFrame.mockRestore();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.IntersectionObserver = originalIntersectionObserver;
  }
});

it("does not re-render a strip wholly on screen when a scroll moves it", async () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver =
    NearScreenIntersectionObserver as unknown as typeof IntersectionObserver;
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  const frames: FrameRequestCallback[] = [];
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((frame) => frames.push(frame));
  let left = 100;
  const rect = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({ left }) as DOMRect);
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let renders = 0;
  function Strip() {
    renders += 1;
    const [, ref] = useThumbnailStripSize();
    return (
      <div>
        <div ref={ref} />
      </div>
    );
  }
  try {
    await act(async () => root.render(<Strip />));
    const settled = renders;

    left = 700;
    act(() => host.dispatchEvent(new Event("scroll")));
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(renders).toBe(settled);
  } finally {
    act(() => root.unmount());
    host.remove();
    rect.mockRestore();
    width.mockRestore();
    requestFrame.mockRestore();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.IntersectionObserver = originalIntersectionObserver;
  }
});

it("reads no strip far from the screen on a scroll, however many clips the timeline mounts", async () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  const frames: FrameRequestCallback[] = [];
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((frame) => frames.push(frame));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Strip() {
    const [, ref] = useThumbnailStripSize();
    return (
      <div>
        <div ref={ref} />
      </div>
    );
  }
  try {
    await act(async () =>
      root.render(Array.from({ length: 50 }, (_, index) => <Strip key={index} />)),
    );
    const reads = vi.spyOn(Element.prototype, "getBoundingClientRect");

    act(() => host.dispatchEvent(new Event("scroll")));
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  } finally {
    act(() => root.unmount());
    host.remove();
    requestFrame.mockRestore();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.IntersectionObserver = originalIntersectionObserver;
  }
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHappyDomRootHarness } from "../player/components/testRootHarness";
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

describe("on a scroll", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const frames: FrameRequestCallback[] = [];
  const harness = createHappyDomRootHarness();
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let left = 0;
  let renders = 0;

  function Strip() {
    renders += 1;
    const [size, ref] = useThumbnailStripSize();
    return (
      <div>
        <div ref={ref} data-in-view-start={size.inViewStart} />
      </div>
    );
  }

  const mountStrips = (count: number) =>
    act(async () =>
      root.render(Array.from({ length: count }, (_, index) => <Strip key={index} />)),
    );

  const scrollAndSettle = () => {
    act(() => host.dispatchEvent(new Event("scroll")));
    act(() => frames.splice(0).forEach((frame) => frame(0)));
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.IntersectionObserver =
      NearScreenIntersectionObserver as unknown as typeof IntersectionObserver;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ left }) as DOMRect,
    );
    left = 0;
    renders = 0;
    host = document.body.appendChild(document.createElement("div"));
    root = harness.mount(host);
  });

  afterEach(() => {
    frames.length = 0;
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it("re-measures every near strip in one shared frame, so a full timeline lays out once", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1_000_000);
    await mountStrips(50);

    left = -10_000;
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    const starts = [...host.querySelectorAll("[data-in-view-start]")].map((strip) =>
      strip.getAttribute("data-in-view-start"),
    );
    expect(starts).toEqual(Array(50).fill("9216"));
  });

  it("does not re-render a strip wholly on screen when it moves", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    left = 100;
    await mountStrips(1);
    const settled = renders;

    left = 700;
    scrollAndSettle();

    expect(renders).toBe(settled);
  });

  it("reads no strip far from the screen, however many clips the timeline mounts", async () => {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    await mountStrips(50);
    const reads = vi.mocked(Element.prototype.getBoundingClientRect);
    reads.mockClear();

    scrollAndSettle();

    expect(reads).not.toHaveBeenCalled();
  });
});

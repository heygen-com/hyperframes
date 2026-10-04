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
  let top = 0;
  let scrolled = 0;
  let stripWidth = 1_000_000;
  let renders = 0;

  function Strip() {
    renders += 1;
    const [size, ref] = useThumbnailStripSize();
    return (
      <div>
        <div ref={ref} data-in-view={`${size.inViewStart}-${size.inViewEnd}`} />
      </div>
    );
  }

  const mountStrips = (count: number) =>
    act(async () =>
      root.render(Array.from({ length: count }, (_, index) => <Strip key={index} />)),
    );

  const spans = () =>
    [...host.querySelectorAll("[data-in-view]")].map((strip) => strip.getAttribute("data-in-view"));

  /** The timeline scrolls so the strips' left edge lands at `nextLeft`, then one frame runs. */
  const scrollTo = (nextLeft: number) => {
    scrolled += left - nextLeft;
    left = nextLeft;
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frames.splice(0).forEach((frame) => frame(0)));
  };

  const neverReportedNear = () => {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.IntersectionObserver =
      NearScreenIntersectionObserver as unknown as typeof IntersectionObserver;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ left, top, width: stripWidth, height: 40 }) as DOMRect,
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => stripWidth);
    left = 0;
    top = 0;
    scrolled = 0;
    stripWidth = 1_000_000;
    renders = 0;
    host = document.body.appendChild(document.createElement("div"));
    host.setAttribute("data-timeline-scroll-viewport", "");
    Object.defineProperty(host, "scrollLeft", { configurable: true, get: () => scrolled });
    root = harness.mount(host);
  });

  afterEach(() => {
    frames.length = 0;
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it("re-measures every near strip in one shared frame, so a full timeline lays out once", async () => {
    await mountStrips(50);

    scrollTo(-10_000);

    expect(spans()).toEqual(Array(50).fill("9216-11776"));
  });

  it("measures the strips a jump brings on screen in that same frame", async () => {
    neverReportedNear();
    left = 50_000;
    await mountStrips(50);
    expect(spans()).toEqual(Array(50).fill("0-0"));

    scrollTo(0);

    expect(spans()).toEqual(Array(50).fill("0-1536"));
  });

  it("does not re-render a strip wholly on screen when it moves", async () => {
    stripWidth = 300;
    left = 100;
    await mountStrips(1);
    const settled = renders;

    scrollTo(700);

    expect(renders).toBe(settled);
  });

  it("does not re-render strips that a jump carries from one side of the screen to the other", async () => {
    left = 50_000;
    await mountStrips(50);
    const settled = renders;

    scrollTo(-2_000_000);

    expect(renders).toBe(settled);
  });

  it("keeps every tile of a short clip, even far from the screen", async () => {
    stripWidth = 300;
    top = 5_000;
    await mountStrips(1);

    expect(spans()).toEqual(["0-300"]);
  });

  it("never re-measures a short clip on a scroll", async () => {
    stripWidth = 300;
    left = 100;
    await mountStrips(1);
    const reads = vi.mocked(Element.prototype.getBoundingClientRect);
    reads.mockClear();

    scrollTo(50);

    expect(reads).not.toHaveBeenCalled();
  });

  it("mounts nothing for a strip far above or below the screen", async () => {
    top = 5_000;
    await mountStrips(1);

    expect(spans()).toEqual(["0-0"]);
  });

  it("measures a strip as it comes near the screen, without waiting for a frame", async () => {
    const reports: IntersectionObserverCallback[] = [];
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) {
        reports.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    await mountStrips(1);
    const strip = host.querySelector("[data-in-view]")!;

    left = -10_000;
    const [presence] = reports;
    act(() =>
      presence!(
        [
          {
            isIntersecting: true,
            target: strip.parentElement!,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );

    expect(frames).toHaveLength(0);
    expect(strip.getAttribute("data-in-view")).toBe("9216-11776");
  });

  it("reads no strip far from the screen, however many clips the timeline mounts", async () => {
    left = 50_000;
    await mountStrips(50);
    const reads = vi.mocked(Element.prototype.getBoundingClientRect);
    reads.mockClear();

    scrollTo(49_900);

    expect(reads).not.toHaveBeenCalled();
  });
});

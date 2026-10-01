// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbnailScheduler } from "../../player/lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../../player/lib/timelineViewportBudgets";
import { CompositionThumbnail } from "../../player/components/CompositionThumbnail";
import { usePlayerStore } from "../../player/store/playerStore";
import { renderPosterForNextOpen } from "../nle/PreviewPoster";
import { mountCompositionsTab } from "./compositionsTabTestUtils";

class DecodingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 16;
  naturalHeight = 9;
  set src(value: string) {
    if (value) queueMicrotask(() => this.onload?.());
  }
}

let autoIntersect = true;
const observed: Array<{ element: Element; callback: IntersectionObserverCallback }> = [];
class ViewportObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(element: Element) {
    observed.push({ element, callback: this.callback });
    if (autoIntersect) this.enter();
  }
  enter() {
    const entry = { isIntersecting: true } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
  disconnect() {}
}

interface Render {
  url: URL;
  signal: AbortSignal;
  answer: (status?: number) => void;
}

const real = {
  IntersectionObserver: globalThis.IntersectionObserver,
  fetch: globalThis.fetch,
  Image: globalThis.Image,
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};
let renders: Render[] = [];
let inFlight = 0;
let peak = 0;
let frames = 0;

beforeEach(() => {
  renders = [];
  [inFlight, peak, frames] = [0, 0, 0];
  globalThis.fetch = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal ?? new AbortController().signal;
        peak = Math.max(peak, ++inFlight);
        const end = () => (inFlight -= 1);
        signal.addEventListener("abort", () => {
          end();
          reject(new DOMException("Aborted", "AbortError"));
        });
        const answer = (status = 200) => {
          end();
          resolve(new Response(new Blob(["png"]), { status }));
        };
        renders.push({ url: new URL(String(input), window.location.origin), signal, answer });
      }),
  ) as typeof fetch;
  globalThis.Image = DecodingImage as unknown as typeof Image;
  globalThis.IntersectionObserver = ViewportObserver as unknown as typeof IntersectionObserver;
  [autoIntersect, observed.length] = [true, 0];
  URL.createObjectURL = vi.fn(() => `blob:frame-${++frames}`);
  URL.revokeObjectURL = vi.fn();
  usePlayerStore.setState({ previewBooted: true });
});

afterEach(() => {
  Object.assign(globalThis, {
    fetch: real.fetch,
    Image: real.Image,
    IntersectionObserver: real.IntersectionObserver,
  });
  Object.assign(URL, { createObjectURL: real.create, revokeObjectURL: real.revoke });
});

const mount = (compositions?: string[]) => mountCompositionsTab(compositions && { compositions });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 5)));
const shown = (host: HTMLElement) => host.querySelector("img")?.getAttribute("src") ?? null;

async function nextRevisionShows(host: HTMLElement, revision: string, frame: string) {
  act(() => usePlayerStore.getState().bumpThumbnailRevisions(null));
  expect(renders.at(-1)!.url.searchParams.get("revision")).toBe(revision);
  renders.at(-1)!.answer();
  await settle();
  expect(shown(host)).toBe(frame);
}

describe("composition card thumbnails", () => {
  it("render through the thumbnail scheduler once the preview boots, and never point an image at the route", async () => {
    usePlayerStore.getState().reset();
    const host = mount();
    expect(renders).toHaveLength(0);

    act(() => usePlayerStore.getState().markPreviewBooted());
    expect(renders.map((r) => [r.url.pathname, r.url.searchParams.get("t")])).toEqual([
      ["/api/projects/demo/thumbnail/compositions/headline.html", "3.00"],
    ]);
    renders[0]!.answer();
    await settle();
    expect(shown(host)).toBe("blob:frame-1");
    expect(host.querySelector("iframe")).toBeNull();

    act(() => usePlayerStore.getState().setTimelineReady(false));
    expect(shown(host)).toBe("blob:frame-1");
  });

  it("wait until a card is near the viewport, so an offscreen card never renders ahead of a visible one", () => {
    autoIntersect = false;
    mount(["compositions/above.html", "compositions/seen.html", "compositions/below.html"]);
    expect(renders).toHaveLength(0);

    const seen = observed.find((o) =>
      o.element.closest("[draggable]")?.textContent?.includes("seen"),
    )!;
    act(() =>
      seen.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(renders.map((r) => r.url.pathname)).toEqual([
      "/api/projects/demo/thumbnail/compositions/seen.html",
    ]);
  });

  it("keep showing the last frame, leased, until the next revision's frame is ready", async () => {
    const host = mount();
    renders[0]!.answer();
    await settle();
    act(() => usePlayerStore.getState().bumpThumbnailRevisions(null));
    expect(shown(host)).toBe("blob:frame-1");
    thumbnailScheduler.invalidateProject("demo");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:frame-1");

    renders.at(-1)!.answer();
    await settle();
    expect(shown(host)).toBe("blob:frame-2");
  });

  it("share one render with the timeline's thumbnail of the same composition", () => {
    mount();
    const timeline = createRoot(document.body.appendChild(document.createElement("div")));
    try {
      act(() =>
        timeline.render(
          <CompositionThumbnail
            previewUrl="/api/projects/demo/preview/comp/compositions/headline.html"
            label=""
            labelColor=""
            projectId="demo"
            sessionEpoch={usePlayerStore.getState().timelineSessionEpoch}
            seekTime={3}
            duration={0}
          />,
        ),
      );
      expect(renders).toHaveLength(1);
    } finally {
      act(() => timeline.unmount());
    }
  });

  it("keep the cards and the poster render to the scheduler's cap, so Studio's own requests get a connection", async () => {
    const cap = TIMELINE_VIEWPORT_BUDGETS.concurrentCompositionFetches;
    mount(Array.from({ length: 6 }, (_, i) => `compositions/scene-${i}.html`));
    renderPosterForNextOpen("demo");
    expect(inFlight).toBe(cap);

    while (renders.some((r) => !r.signal.aborted)) {
      renders.shift()!.answer();
      await settle();
    }
    expect(renders).toHaveLength(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(7);
    expect(peak).toBe(cap);
  });

  it("abort a stale revision's render, and free its frame when the scheduler evicts it", async () => {
    const host = mount();
    const first = renders[0]!;
    await nextRevisionShows(host, "1", "blob:frame-1");
    expect(first.signal.aborted).toBe(true);
    await nextRevisionShows(host, "2", "blob:frame-2");

    thumbnailScheduler.invalidateProject("demo");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:frame-2");
  });

  it("show a fallback when the render fails, and retry it at the next content revision", async () => {
    const host = mount();
    renders[0]!.answer(500);
    await settle();
    expect(host.textContent).toContain("Preview unavailable");
    await nextRevisionShows(host, "1", "blob:frame-1");
  });
});

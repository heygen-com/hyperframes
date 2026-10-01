// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbnailScheduler } from "../../player/lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../../player/lib/timelineViewportBudgets";
import { usePlayerStore } from "../../player/store/playerStore";
import { renderPosterForNextOpen } from "../nle/PreviewPoster";
import { CompositionsTab } from "./CompositionsTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;

class DecodingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 16;
  naturalHeight = 9;
  set src(value: string) {
    if (value) queueMicrotask(() => this.onload?.());
  }
}

interface Render {
  url: URL;
  signal: AbortSignal;
  answer: (status?: number) => void;
}

const real = {
  fetch: globalThis.fetch,
  Image: globalThis.Image,
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};
let renders: Render[] = [];
let inFlight = 0;
let peak = 0;
let frames = 0;
let root: Root | null = null;

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
  URL.createObjectURL = vi.fn(() => `blob:frame-${++frames}`);
  URL.revokeObjectURL = vi.fn();
  usePlayerStore.setState({ previewBooted: true });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  thumbnailScheduler.invalidateProject("demo");
  Object.assign(globalThis, { fetch: real.fetch, Image: real.Image });
  Object.assign(URL, { createObjectURL: real.create, revokeObjectURL: real.revoke });
  document.body.innerHTML = "";
  usePlayerStore.setState({ thumbnailRevisions: {} });
});

function mount(compositions = ["compositions/headline.html"]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CompositionsTab
        projectId="demo"
        compositions={compositions}
        activeComposition={null}
        onSelect={vi.fn()}
      />,
    );
  });
  return host;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 5)));
const shown = (host: HTMLElement) => host.querySelector("img")?.getAttribute("src") ?? null;

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
    act(() => usePlayerStore.getState().bumpThumbnailRevisions(null));
    expect(first.signal.aborted).toBe(true);
    expect(renders.at(-1)!.url.searchParams.get("revision")).toBe("1");

    renders.at(-1)!.answer();
    await settle();
    expect(shown(host)).toBe("blob:frame-1");
    act(() => usePlayerStore.getState().bumpThumbnailRevisions(null));
    renders.at(-1)!.answer();
    await settle();
    expect(shown(host)).toBe("blob:frame-2");

    thumbnailScheduler.invalidateProject("demo");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:frame-2");
  });

  it("show a fallback when the render fails, and retry it at the next content revision", async () => {
    const host = mount();
    renders[0]!.answer(500);
    await settle();
    expect(host.textContent).toContain("Preview unavailable");

    act(() => usePlayerStore.getState().bumpThumbnailRevisions(null));
    expect(renders.at(-1)!.url.searchParams.get("revision")).toBe("1");
    renders.at(-1)!.answer();
    await settle();
    expect(shown(host)).toBe("blob:frame-1");
  });
});

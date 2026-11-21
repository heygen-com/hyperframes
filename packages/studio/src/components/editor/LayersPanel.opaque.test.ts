// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import { LayersPanel } from "./LayersPanel";
import type { LayerReorderEvent } from "./useLayerDrag";
import type { DomEditLayerItem, DomEditSelection } from "./domEditing";
import { announcePreviewDocumentLoaded } from "../../player/sceneSwap";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { standInFor } from "./previewSelection";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { applyUndoRestoreToPreview } from "../../utils/gsapUndoRestore";

installReactActEnvironment();

const mocks = vi.hoisted(() => ({
  previewIframeRef: { current: null } as { current: unknown },
  activeGroupElement: null as HTMLElement | null,
  applyDomSelection: vi.fn(),
  setActiveGroupElement: vi.fn(),
  // While set, a layers read waits on it after the frame answers.
  hold: null as Promise<void> | null,
  answered: 0,
  showToast: vi.fn(),
  commitZ: vi.fn(async () => ({ durable: true })),
  onReorder: null as ((event: LayerReorderEvent) => void) | null,
  sorted: [] as DomEditLayerItem[],
}));
vi.mock("./layersPanelSort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layersPanelSort")>();
  return {
    ...actual,
    sortLayersByZIndex: (layers: DomEditLayerItem[]) =>
      (mocks.sorted = actual.sortLayersByZIndex(layers)),
  };
});
vi.mock("./useLayerDrag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useLayerDrag")>();
  return {
    ...actual,
    useLayerDrag: (options: Parameters<typeof actual.useLayerDrag>[0]) => {
      mocks.onReorder = options.onReorder;
      return actual.useLayerDrag(options);
    },
  };
});
vi.mock("../../player/lib/previewElements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewElements")>();
  return {
    ...actual,
    previewLayers: async (...args: Parameters<typeof actual.previewLayers>) => {
      const reply = await actual.previewLayers(...args);
      mocks.answered += 1;
      await mocks.hold;
      return reply;
    },
  };
});
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContextOptional: () => ({
    previewIframeRef: mocks.previewIframeRef,
    activeCompPath: "index.html",
    showToast: mocks.showToast,
  }),
  useStudioPlaybackContextOptional: () => ({
    refreshKey: 0,
    compositionLoading: false,
    timelineElements: [],
    isPlaying: false,
  }),
}));
vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({
    domEditSelection: null,
    activeGroupElement: mocks.activeGroupElement,
    applyDomSelection: mocks.applyDomSelection,
    updateDomEditHoverSelection: vi.fn(),
    handleDomZIndexReorderCommit: mocks.commitZ,
    setActiveGroupElement: mocks.setActiveGroupElement,
  }),
}));
vi.mock("../nle/useCanvasZOrderTimelineMirror", () => ({
  useLayerReorderTimelineMirror: () => vi.fn(),
}));

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  mocks.activeGroupElement = null;
  mocks.hold = null;
  mocks.answered = 0;
  mocks.sorted = [];
  vi.clearAllMocks();
  usePreviewIframeStore.setState({ iframe: null });
  document.body.innerHTML = "";
  delete (window as { __player?: unknown }).__player;
});

it("lists an opaque frame's layers, selects a row, and drills into a group row", async () => {
  document.body.innerHTML = `<main data-composition-id="main">
    <div id="card"><h1 id="title">Hi</h1></div>
    <div id="pair" data-hf-group="pair"><i id="a"></i></div>
    <div id="host" data-composition-src="compositions/intro-card.html"></div></main>`;
  const iframe = sealedPreviewFrame().iframe;
  mocks.previewIframeRef.current = iframe;
  usePreviewIframeStore.setState({ iframe });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(LayersPanel)));
  closers.push(() => act(() => root.unmount()));

  const rows = () => [...host.querySelectorAll<HTMLElement>("[data-layer-index]")];
  await vi.waitFor(() => expect(rows()).toHaveLength(5));
  const named = (label: string) => rows().find((r) => r.textContent?.includes(label))!;
  expect(named("Title").querySelector("[data-layer-kind]")!.getAttribute("data-layer-kind")).toBe(
    "text",
  );
  expect(named("pair").title).toBe("Double-click to enter group");
  const hostIcon = named("Intro").querySelector("[data-layer-kind]")!;
  expect(hostIcon.className).toContain("bg-on");

  act(() => named("Title").click());
  await vi.waitFor(() => expect(mocks.applyDomSelection).toHaveBeenCalled());
  const picked = mocks.applyDomSelection.mock.calls[0]![0] as DomEditSelection;
  expect(picked).toMatchObject({ id: "title", selector: "#title" });
  expect(picked.handle).toBeTruthy();

  act(() => void named("pair").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await vi.waitFor(() => expect(mocks.setActiveGroupElement).toHaveBeenCalledOnce());
  const group = mocks.setActiveGroupElement.mock.calls[0]![0] as HTMLElement;
  expect(group.hasAttribute("data-hf-group")).toBe(false);
});

function renderPanel(iframe: HTMLIFrameElement) {
  mocks.previewIframeRef.current = iframe;
  usePreviewIframeStore.setState({ iframe });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(LayersPanel)));
  closers.push(() => act(() => root.unmount()));
  return () =>
    [...host.querySelectorAll<HTMLElement>("[data-layer-index]")].map((r) => r.textContent);
}

it("leaves a drill-in whose group a reload took, rather than list the whole page under it", async () => {
  document.body.innerHTML = `<main data-composition-id="main">
    <div id="card"></div><div id="pair" data-hf-group="pair"><i id="a"></i></div></main>`;
  const iframe = sealedPreviewFrame().iframe;
  const [pair] = (await queryPreviewElements(iframe, "#pair"))!.matches;
  const [described] = (await describePreviewElements(iframe, [pair!.handle]))!;
  mocks.activeGroupElement = standInFor(iframe, described!);
  document.getElementById("pair")!.remove();
  const rows = renderPanel(iframe);
  await vi.waitFor(() => expect(mocks.setActiveGroupElement).toHaveBeenCalledWith(null));
  expect(rows()).toEqual([]);
});

it("reads the layers once more when a refresh lands while a read is in flight", async () => {
  document.body.innerHTML = `<main data-composition-id="main"><div id="card"></div></main>`;
  let release!: () => void;
  mocks.hold = new Promise<void>((resolve) => (release = resolve));
  const iframe = sealedPreviewFrame().iframe;
  const rows = renderPanel(iframe);
  await vi.waitFor(() => expect(mocks.answered).toBe(1));
  // Past the panel's settle timer, so only the announced refresh can bring the new layer.
  await new Promise((resolve) => setTimeout(resolve, 150));
  // The first read has its answer and is waiting; the page changes and announces it.
  document.querySelector("main")!.insertAdjacentHTML("beforeend", `<div id="late"></div>`);
  act(() => announcePreviewDocumentLoaded(iframe));
  act(() => release());
  await vi.waitFor(() => expect(rows()).toEqual(["Late", "Card"]));
});

/** The panel's rows once listed, and a drop of `label` to the top of its siblings. */
async function sealedStack(markup: string) {
  document.body.innerHTML = `<main data-composition-id="main">${markup}</main>`;
  const iframe = sealedPreviewFrame().iframe;
  renderPanel(iframe);
  await vi.waitFor(() => expect(mocks.sorted.length).toBeGreaterThan(1));
  return (label: string) => {
    const depth = mocks.sorted.find((layer) => layer.id === label)!.depth;
    const siblingLayers = mocks.sorted.filter((layer) => layer.depth === depth);
    const fromIndex = siblingLayers.findIndex((layer) => layer.id === label);
    act(() => mocks.onReorder!({ siblingLayers, fromIndex, toIndex: 0 }));
  };
}

it("restacks a sealed layer dragged to the top, saving its z-index through its stand-in", async () => {
  const drop = await sealedStack(
    `<div id="back" style="position: relative; z-index: 1"></div>
     <div id="front" style="position: relative; z-index: 2"></div>`,
  );
  drop("back");
  await vi.waitFor(() => expect(mocks.commitZ).toHaveBeenCalledOnce());
  const [entries, , source] = mocks.commitZ.mock.calls[0]! as unknown as [
    Array<{ element: HTMLElement; zIndex: number; id?: string }>,
    string,
    string,
  ];
  expect(source).toBe("layer-drag");
  expect(entries).toEqual([expect.objectContaining({ id: "back", zIndex: 3 })]);
  expect(entries[0]!.element.isConnected).toBe(false);
});

it("refuses to restack a sealed layer inside a locked clip, and saves nothing", async () => {
  const drop = await sealedStack(
    `<div data-timeline-locked>
       <div id="back" style="position: relative; z-index: 1"></div>
       <div id="front" style="position: relative; z-index: 2"></div>
     </div>`,
  );
  drop("back");
  await vi.waitFor(() =>
    expect(mocks.showToast).toHaveBeenCalledWith("This layer can't be reordered", "info"),
  );
  expect(mocks.commitZ).not.toHaveBeenCalled();
});

/** A composition whose `back` layer sits at `z` under `front` at 2, as the page and as its saved file. */
const restack = (z: number) =>
  `<main data-composition-id="main" data-hf-id="main"><div id="back" data-hf-id="back" style="z-index: ${z}"></div><div id="front" data-hf-id="front" style="z-index: 2"></div></main>`;

// fails without the fix: an in-place undo announced nothing the panel reads, so its rows kept the old order.
it("lists the layers in their new order after an undo restacks them in place", async () => {
  document.body.innerHTML = restack(1);
  (window as { __player?: unknown }).__player = { seek: () => {} };
  const iframe = sealedPreviewFrame().iframe;
  const rows = renderPanel(iframe);
  await vi.waitFor(() => expect(rows()).toEqual(["Front", "Back"]));
  // Past the panel's settle timer, so only the undo can bring the new order.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const page = (z: number) => `<html><body>${restack(z)}</body></html>`;
  const reload = vi.fn();
  const files = { "index.html": { previous: page(1), restored: page(3) } };
  act(() => void applyUndoRestoreToPreview(iframe, "index.html", files, 0, reload));
  await vi.waitFor(() => expect(document.getElementById("back")!.style.zIndex).toBe("3"));
  expect(reload).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(rows()).toEqual(["Back", "Front"]));
});

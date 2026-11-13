// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import type { DomEditSelection } from "./domEditing";
import { LayersPanel } from "./LayersPanel";
import { announcePreviewDocumentLoaded } from "../../player/sceneSwap";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { standInFor } from "./previewSelection";

installReactActEnvironment();

const mocks = vi.hoisted(() => ({
  previewIframeRef: { current: null } as { current: unknown },
  activeGroupElement: null as HTMLElement | null,
  applyDomSelection: vi.fn(),
  setActiveGroupElement: vi.fn(),
  // While set, a layers read waits on it after the frame answers.
  hold: null as Promise<void> | null,
  answered: 0,
}));
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
    showToast: vi.fn(),
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
    handleDomZIndexReorderCommit: vi.fn(),
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
  vi.clearAllMocks();
  usePreviewIframeStore.setState({ iframe: null });
  document.body.innerHTML = "";
});

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  return iframe;
}

it("lists an opaque frame's layers, selects a row, and drills into a group row", async () => {
  document.body.innerHTML = `<main data-composition-id="main">
    <div id="card"><h1 id="title">Hi</h1></div>
    <div id="pair" data-hf-group="pair"><i id="a"></i></div>
    <div id="host" data-composition-src="compositions/intro-card.html"></div></main>`;
  const iframe = opaqueFrame();
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
  expect(named("pair").title).toBe("This layer can't be reordered");
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
  const iframe = opaqueFrame();
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
  const iframe = opaqueFrame();
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

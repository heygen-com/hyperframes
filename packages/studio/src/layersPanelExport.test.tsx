// @vitest-environment happy-dom
// Mounts the Layers panel by package name with no Studio shell, as a host app does.
import { act, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DomEditProvider,
  LayersPanel,
  TimelineEditProvider,
  usePlayerStore,
  type LayersPanelHost,
} from "@hyperframes/studio";
import { installReactActEnvironment, mountReactHarness } from "./hooks/domSelectionTestHarness";
import { deriveTimelineStoreKeyForDomId } from "./player/lib/timelineElementHelpers";

installReactActEnvironment();

const flush = () => act(async () => {});
const rowLabels = () =>
  [...document.querySelectorAll("[data-layer-index]")].map((row) => row.textContent);
const clip = (id: string, track: number) => {
  const key = deriveTimelineStoreKeyForDomId(id, "index.html");
  return { id: key, key, domId: id, tag: "div", start: 0, duration: 4, track };
};
const bgTrack = () => usePlayerStore.getState().elements.find((e) => e.domId === "bg")?.track;

afterEach(() => {
  usePlayerStore.setState({ elements: [] });
  document.body.innerHTML = "";
});

/** The host's preview (title in front of bg, rows to match) and its edit session, mounted around the panel. */
async function mountPanel(wrap: (panel: ReactNode) => ReactNode = (panel) => panel) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<div data-composition-id="main"><div id="bg" style="z-index:1"></div><div id="title" style="z-index:2"></div></div>';
  usePlayerStore.setState({ elements: [clip("title", 0), clip("bg", 1)] });
  const session = {
    domEditSelection: null,
    activeGroupElement: null,
    applyDomSelection: vi.fn(),
    updateDomEditHoverSelection: vi.fn(),
    handleDomZIndexReorderCommit: vi.fn(async () => ({
      durable: true,
      allMatched: true,
      changed: true,
    })),
    setActiveGroupElement: vi.fn(),
  } as unknown as Parameters<typeof DomEditProvider>[0]["value"];
  const host: LayersPanelHost = {
    previewIframeRef: { current: iframe },
    activeCompPath: null,
    showToast: vi.fn(),
    timelineElements: usePlayerStore.getState().elements,
    isPlaying: false,
  };
  const root = mountReactHarness(
    <DomEditProvider value={session}>{wrap(<LayersPanel host={host} />)}</DomEditProvider>,
  );
  await flush();
  return { doc, session, root };
}

/** Drags the back row (bg) above the front one. */
async function dragBackRowToFront() {
  const rows = document.querySelectorAll<HTMLElement>("[data-layer-index]");
  rows.forEach((row, i) =>
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(0, i * 24, 200, 24)),
  );
  const pointer = (type: string, clientY: number) =>
    new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY });
  const list = rows[0]!.parentElement!;
  list.setPointerCapture = () => {};
  act(() => void rows[1]!.dispatchEvent(pointer("pointerdown", 36)));
  act(() => {
    list.dispatchEvent(pointer("pointermove", 20));
    list.dispatchEvent(pointer("pointermove", 2));
  });
  await act(async () => void list.dispatchEvent(pointer("pointerup", 2)));
  await flush();
}

it("lists, selects and reorders the host's preview layers through the host's session", async () => {
  const { doc, session, root } = await mountPanel();

  expect(rowLabels()).toEqual(["DiTitle", "DiBg"]);

  const rows = document.querySelectorAll<HTMLElement>("[data-layer-index]");
  await act(async () => rows[0]!.click());
  expect(session.applyDomSelection).toHaveBeenCalledWith(
    expect.objectContaining({ element: doc.getElementById("title") }),
  );

  await dragBackRowToFront();
  expect(session.handleDomZIndexReorderCommit).toHaveBeenCalledTimes(1);
  const [entries] = vi.mocked(session.handleDomZIndexReorderCommit).mock.calls[0]!;
  const z = Object.fromEntries(entries.map((e) => [e.element.id, e.zIndex]));
  expect(z.bg).toBeGreaterThan(Number(doc.getElementById("title")!.style.zIndex));
  // No TimelineEditProvider, so nothing can save a lane move: the row stays where the file says.
  expect(bgTrack()).toBe(1);
  await act(async () => root.unmount());
});

it("mirrors the reorder into the timeline rows through the host's move handler", async () => {
  const onMoveElements = vi.fn(async () => {});
  const { root } = await mountPanel((panel) => (
    <TimelineEditProvider value={{ onMoveElements }}>{panel}</TimelineEditProvider>
  ));

  await dragBackRowToFront();
  expect(onMoveElements).toHaveBeenCalledTimes(1);
  expect(bgTrack()).not.toBe(1);
  await act(async () => root.unmount());
});

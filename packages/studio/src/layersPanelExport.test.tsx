// @vitest-environment happy-dom
// Mounts the Layers panel by package name with no Studio shell, as a host app does.
import { act } from "react";
import { expect, it, vi } from "vitest";
import { DomEditProvider, LayersPanel, type LayersPanelHost } from "@hyperframes/studio";
import { installReactActEnvironment, mountReactHarness } from "./hooks/domSelectionTestHarness";

installReactActEnvironment();

const flush = () => act(async () => {});
const rowLabels = () =>
  [...document.querySelectorAll("[data-layer-index]")].map((row) => row.textContent);

it("lists, selects and reorders the host's preview layers through the host's session", async () => {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<div data-composition-id="main"><div id="bg" style="z-index:1"></div><div id="title" style="z-index:2"></div></div>';
  const session = {
    domEditSelection: null,
    activeGroupElement: null,
    applyDomSelection: vi.fn(),
    updateDomEditHoverSelection: vi.fn(),
    handleDomZIndexReorderCommit: vi.fn(async () => ({ ok: true })),
    setActiveGroupElement: vi.fn(),
  } as unknown as Parameters<typeof DomEditProvider>[0]["value"];
  const host: LayersPanelHost = {
    previewIframeRef: { current: iframe },
    activeCompPath: null,
    showToast: vi.fn(),
    timelineElements: [],
    isPlaying: false,
  };
  const root = mountReactHarness(
    <DomEditProvider value={session}>
      <LayersPanel host={host} />
    </DomEditProvider>,
  );
  await flush();

  expect(rowLabels()).toEqual(["DiTitle", "DiBg"]);

  const rows = document.querySelectorAll<HTMLElement>("[data-layer-index]");
  await act(async () => rows[0]!.click());
  expect(session.applyDomSelection).toHaveBeenCalledWith(
    expect.objectContaining({ element: doc.getElementById("title") }),
  );

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

  expect(session.handleDomZIndexReorderCommit).toHaveBeenCalledTimes(1);
  const [entries] = vi.mocked(session.handleDomZIndexReorderCommit).mock.calls[0]!;
  const z = Object.fromEntries(entries.map((e) => [e.element.id, e.zIndex]));
  expect(z.bg).toBeGreaterThan(Number(doc.getElementById("title")!.style.zIndex));
  await act(async () => root.unmount());
});

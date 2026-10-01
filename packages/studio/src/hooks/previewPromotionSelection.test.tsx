// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { resolveElementForOverlay } from "../components/editor/domEditOverlayGeometry";
import type { UseDomEditOverlayGesturesOptions } from "../components/editor/domEditOverlayGestures";
import { createDomEditOverlayGestureHandlers } from "../components/editor/useDomEditOverlayGestures";
import {
  makeAdapterWindow,
  makeFakeIframe,
  resetPlayerStore,
} from "../player/hooks/timelinePlayerTestHarness";
import { useTimelinePlayer } from "../player/hooks/useTimelinePlayer";
import { announcePreviewPromoted } from "../player/sceneSwap";
import { stageElementOffset } from "./elementOffsetStager";
import { savePlainRotation } from "./plainRotation";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import { useLivePreviewIframe } from "./useLivePreviewIframe";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../utils/gsapSoftReload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/gsapSoftReload")>()),
  ensureMotionPathPluginLoaded: vi.fn(),
}));

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
});

function previewWithTitle(query = ""): HTMLIFrameElement {
  const iframe = makeFakeIframe(makeAdapterWindow().win);
  iframe.src = `http://localhost/api/projects/demo/preview${query}`;
  iframe.contentDocument!.body.innerHTML = '<h1 id="title">Title</h1>';
  return iframe;
}

const titleOf = (iframe: HTMLIFrameElement | null) =>
  iframe!.contentDocument!.getElementById("title") as HTMLElement;

const selectionOf = (element: HTMLElement) =>
  ({ element, id: "title", selector: "#title", label: "title" }) as unknown as DomEditSelection;

type Player = ReturnType<typeof useTimelinePlayer>;

/** A host shaped like Desktop's: it reads its iframe once and never re-renders for a reload. */
function mountHost(followPromotions: boolean) {
  const selectionRef = { current: null as DomEditSelection | null };
  let player: Player | null = null;
  function PlayerHost() {
    player = useTimelinePlayer();
    return null;
  }
  function Session({ host }: { host: HTMLIFrameElement }) {
    const live = useLivePreviewIframe(host);
    useDomEditPreviewSync({
      previewIframe: followPromotions ? live : host,
      activeCompPath: null,
      captionEditMode: false,
      domEditSelectionRef: selectionRef,
      domEditGroupSelectionsRef: { current: [] },
      domEditSelection: selectionRef.current,
      refreshDomEditGroupSelectionsFromPreview: async () => {},
      applyDomSelection: (selection) => void (selectionRef.current = selection),
      buildDomSelectionFromTarget: async (element) => selectionOf(element),
      refreshPreviewDocumentVersion: () => {},
      syncPreviewHotkeys: () => {},
      applyStudioManualEditsToPreviewRef: { current: async () => {} },
    });
    return null;
  }
  const playerRoot = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => playerRoot.render(React.createElement(PlayerHost)));
  const live = previewWithTitle();
  act(() => {
    player!.iframeRef.current = live;
    player!.onIframeLoad();
  });
  selectionRef.current = selectionOf(titleOf(live));
  const sessionRoot = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => sessionRoot.render(React.createElement(Session, { host: live })));
  return { player: () => player!, selectionRef, live, sessionRoot, playerRoot };
}

/** The real shadow reload: load a shadow, report it painted, and let the player promote it. */
async function promoteShadow(player: () => Player): Promise<HTMLIFrameElement> {
  act(() => player().refreshPlayer());
  const slot = player().previewSlots.find((s) => s.role === "shadow")!;
  const shadow = previewWithTitle("?_t=1");
  act(() => player().setShadowIframeNode(shadow));
  await act(async () => {
    player().onShadowIframeLoad(slot.gen);
    player().onShadowReadyChange(slot.gen, true);
  });
  expect(player().iframeRef.current).toBe(shadow);
  return shadow;
}

describe("a shadow reload promoted without a host re-render", () => {
  it("moves the selection to the node now on screen, so a rotate and a move draw on it", async () => {
    const host = mountHost(true);
    const shadow = await promoteShadow(host.player);

    const selection = host.selectionRef.current!;
    expect(selection.element).toBe(titleOf(shadow));
    const overlayNode = resolveElementForOverlay(shadow.contentDocument!, selection, null, {
      current: null,
    });
    expect(overlayNode).toBe(selection.element);

    const commitPositionPatchToHtml = vi.fn(async () => {});
    await savePlainRotation({ commitPositionPatchToHtml }, selection, { angle: 30 });
    await stageElementOffset(
      { commitPositionPatchToHtml, showToast: vi.fn() },
      selection,
      { x: 10, y: 5 },
      true,
    ).save();
    expect(titleOf(shadow).style.getPropertyValue("rotate")).toBe("30deg");
    expect(titleOf(shadow).style.getPropertyValue("translate")).toBe("10px 5px");
    expect(titleOf(host.live).getAttribute("style")).toBeNull();
    act(() => host.sessionRoot.unmount());
    act(() => host.playerRoot.unmount());
  });

  it("left the selection on the retired node when the session kept the host's first iframe", async () => {
    const host = mountHost(false);
    await promoteShadow(host.player);
    expect(host.selectionRef.current!.element).toBe(titleOf(host.live));
    act(() => host.sessionRoot.unmount());
    act(() => host.playerRoot.unmount());
  });
});

describe("useLivePreviewIframe", () => {
  function track(host: HTMLIFrameElement) {
    const seen: Array<HTMLIFrameElement | null> = [];
    function Probe({ iframe }: { iframe: HTMLIFrameElement }) {
      seen.push(useLivePreviewIframe(iframe));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Probe, { iframe: host })));
    const rerender = (iframe: HTMLIFrameElement) =>
      act(() => root.render(React.createElement(Probe, { iframe })));
    return { live: () => seen.at(-1), rerender, root };
  }

  it("follows each promotion of its own preview and ignores another preview's", () => {
    const [a, b, c, other] = [0, 1, 2, 3].map(() => document.createElement("iframe"));
    const probe = track(a!);
    act(() => announcePreviewPromoted({ retired: other!, live: c! }));
    expect(probe.live()).toBe(a);
    act(() => announcePreviewPromoted({ retired: a!, live: b! }));
    expect(probe.live()).toBe(b);
    act(() => announcePreviewPromoted({ retired: b!, live: c! }));
    expect(probe.live()).toBe(c);
    act(() => probe.root.unmount());
  });

  it("takes a new host iframe as given, and stops listening on unmount", () => {
    const [a, b, d] = [0, 1, 2].map(() => document.createElement("iframe"));
    const probe = track(a!);
    act(() => announcePreviewPromoted({ retired: a!, live: b! }));
    probe.rerender(d!);
    expect(probe.live()).toBe(d);
    const remove = vi.spyOn(document, "removeEventListener");
    act(() => probe.root.unmount());
    expect(remove).toHaveBeenCalledWith("hf-preview-promoted", expect.any(Function));
  });
});

describe("a promotion during a gesture", () => {
  it("drops the gesture instead of saving the node that left the screen", () => {
    const retired = previewWithTitle();
    const element = titleOf(retired);
    const selection = {
      ...selectionOf(element),
      capabilities: { canApplyManualRotation: true },
    } as unknown as DomEditSelection;
    const onRotationCommit = vi.fn();
    const ref = <T,>(current: T) => ({ current });
    const opts = {
      overlayRef: ref(document.createElement("div")),
      iframeRef: ref<HTMLIFrameElement | null>(retired),
      boxRef: ref(document.createElement("div")),
      selectionRef: ref(selection),
      hoverSelectionRef: ref(null),
      overlayRectRef: ref({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        editScaleX: 1,
        editScaleY: 1,
      }),
      groupOverlayItemsRef: ref([]),
      gestureRef: ref(null),
      groupGestureRef: ref(null),
      blockedMoveRef: ref(null),
      rafPausedRef: ref(false),
      suppressNextBoxClickRef: ref(false),
      setOverlayRect: () => {},
      setGroupOverlayItems: () => {},
      onRotationCommitRef: ref(onRotationCommit),
      onCanvasPointerMoveRef: ref(() => Promise.resolve(null)),
      onCanvasMouseDown: () => {},
      snapGuidesRef: ref(null),
    } as unknown as UseDomEditOverlayGesturesOptions;
    const pointer = (clientX: number, clientY: number) =>
      ({
        clientX,
        clientY,
        pointerId: 1,
        button: 0,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
        currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
      }) as never;
    const handlers = createDomEditOverlayGestureHandlers(opts);
    handlers.startGesture("rotate", pointer(200, 50));
    handlers.onPointerMove(pointer(100, 150));
    opts.iframeRef.current = previewWithTitle("?_t=1");
    handlers.onPointerUp(pointer(100, 150));
    expect(onRotationCommit).not.toHaveBeenCalled();
    expect(opts.gestureRef.current).toBeNull();
  });
});

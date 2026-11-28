// @vitest-environment happy-dom

import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { requestOverlayFrames, resetOverlayFrameLoopForTests } from "./overlayFrameLoop";
import { usePlayerStore } from "../../player/store/playerStore";
import { domSelectionSet } from "../../hooks/domSelectionSignal";
import { makeSelection, mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { previewRequest } from "../../player/lib/previewChannel";
import {
  detachedFakeIframe,
  serveEditingRequests,
} from "../../player/hooks/timelinePlayerTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((clean) => clean());
  resetOverlayFrameLoopForTests();
  usePlayerStore.setState({ previewBooted: false });
});

/** A frame Studio cannot script, whose runtime answers geometry; returns each geometry read's handles. While
 * `holding`, geometry answers wait until `release()`. */
function sealedFrame() {
  const held: Array<() => void> = [];
  const gate = { holding: false };
  const arrived: string[][] = [];
  const holdGeometry = (port: MessagePort) =>
    queueMicrotask(() => {
      const answer = port.onmessage!.bind(port);
      port.onmessage = (event: MessageEvent<{ kind: string; params: { handles?: string[] } }>) => {
        if (event.data.kind === "geometry") arrived.push(event.data.params.handles ?? []);
        if (gate.holding && event.data.kind === "geometry") held.push(() => answer(event));
        else answer(event);
      };
    });
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const frameAnswer = (kind: string, params: unknown) =>
    kind === "geometry"
      ? { elements: (params as { handles: string[] }).handles.map(() => null), children: null }
      : {};
  cleanups.push(serveEditingRequests(frame, frameAnswer, holdGeometry));
  const geometryReads = () => arrived;
  const release = () => held.splice(0).forEach((send) => send());
  return { iframe, geometryReads, gate, release };
}

const sealedSelection = (label: string): DomEditSelection => ({
  ...makeSelection(label, document.createElement("div")),
  handle: `load:${label}`,
});

function Overlay(props: Parameters<typeof useDomEditOverlayRects>[0]) {
  useDomEditOverlayRects(props);
  return null;
}

// fails without the fix: the overlay asked only on its next frame after React rendered the group, which on a
// sealed frame waited behind that render and its reply behind two more host frames.
it("asks an opaque frame for a newly set group's rects when it is set, not after it renders", async () => {
  const { iframe, geometryReads } = sealedFrame();
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const title = sealedSelection("title");
  const subtitle = sealedSelection("subtitle");
  // The refs a render would update stay at the old single pick: only the set can name the group.
  const selectionRef = { current: title as DomEditSelection | null };
  const groupSelectionsRef = { current: [] as DomEditSelection[] };
  const root: Root = mountReactHarness(
    <Overlay
      iframeRef={{ current: iframe }}
      overlayRef={{ current: document.createElement("div") }}
      selectionRef={selectionRef}
      activeCompositionPathRef={{ current: null }}
      groupSelectionsRef={groupSelectionsRef}
      hoverSelectionRef={{ current: null }}
      rafPausedRef={{ current: false }}
    />,
  );
  cleanups.push(() => act(() => root.unmount()));
  domSelectionSet(title, [title, subtitle]);
  await vi.waitFor(() => expect(geometryReads()).toContainEqual(["load:title", "load:subtitle"]));
});

it("keeps one read in flight for its own frames, and lets only a newly set selection ask past it", async () => {
  const { iframe, geometryReads, gate, release } = sealedFrame();
  await previewRequest(iframe, "set-loop-start", { seconds: 0 });
  const title = sealedSelection("title");
  const subtitle = sealedSelection("subtitle");
  const hoverSelectionRef = { current: null as DomEditSelection | null };
  const root: Root = mountReactHarness(
    <Overlay
      iframeRef={{ current: iframe }}
      overlayRef={{ current: document.createElement("div") }}
      selectionRef={{ current: title }}
      activeCompositionPathRef={{ current: null }}
      groupSelectionsRef={{ current: [] }}
      hoverSelectionRef={hoverSelectionRef}
      rafPausedRef={{ current: false }}
    />,
  );
  cleanups.push(() => act(() => root.unmount()));
  cleanups.push(release);
  usePlayerStore.setState({ previewBooted: true });
  gate.holding = true;
  requestOverlayFrames();
  await vi.waitFor(() => expect(geometryReads()).toEqual([["load:title"]]));
  // A hover moving on while that read is out waits for it: a pointer sweep must not stack reads on the frame.
  hoverSelectionRef.current = subtitle;
  requestOverlayFrames();
  await new Promise((done) => setTimeout(done, 100));
  expect(geometryReads()).toEqual([["load:title"]]);
  domSelectionSet(title, [title, subtitle]);
  await vi.waitFor(() =>
    expect(geometryReads()).toEqual([["load:title"], ["load:title", "load:subtitle"]]),
  );
});

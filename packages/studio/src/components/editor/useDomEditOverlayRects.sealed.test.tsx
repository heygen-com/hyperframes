// @vitest-environment happy-dom

import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { domSelectionSet } from "../../hooks/domSelectionSignal";
import { makeSelection, mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { previewRequest } from "../../player/lib/previewChannel";
import {
  detachedFakeIframe,
  serveEditingRequests,
} from "../../player/hooks/timelinePlayerTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));

/** A frame Studio cannot script, whose runtime answers geometry; returns each geometry read's handles. */
function sealedFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const handed = vi.fn((kind: string, params: unknown) =>
    kind === "geometry"
      ? { elements: (params as { handles: string[] }).handles.map(() => null), children: null }
      : {},
  );
  cleanups.push(serveEditingRequests(frame, handed));
  const geometryReads = () =>
    handed.mock.calls
      .filter(([kind]) => kind === "geometry")
      .map(([, params]) => (params as { handles: string[] }).handles);
  return { iframe, geometryReads };
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

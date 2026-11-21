// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  beginStudioManualEditGesture,
  endStudioManualEditGesture,
} from "../../components/editor/manualEdits";
import { standInFor } from "../../components/editor/previewSelection";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sealed = vi.hoisted(() => new Set<HTMLIFrameElement>());

vi.mock("../lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/previewChannel")>()),
  previewFrameOpaque: (iframe: HTMLIFrameElement) => sealed.has(iframe),
}));

vi.mock("../../utils/gsapSoftReload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/gsapSoftReload")>()),
  ensureMotionPathPluginLoaded: vi.fn(),
}));

afterEach(() => {
  sealed.clear();
  document.body.innerHTML = "";
  resetPlayerStore();
});

function previewFrame(query: string): HTMLIFrameElement {
  const iframe = makeFakeIframe(makeAdapterWindow().win);
  iframe.src = `http://localhost/api/projects/demo/preview${query}`;
  return iframe;
}

it("keeps a sealed preview on screen through a resize on its stand-in, and swaps in the reload once it ends", () => {
  const { getApi, root } = renderTimelinePlayerHarness();
  const live = previewFrame("");
  act(() => {
    getApi().iframeRef.current = live;
    getApi().onIframeLoad();
  });
  sealed.add(live);
  const description = { handle: "box", tag: "div", inlineStyles: {}, attributes: [] };
  const standIn = standInFor(live, description as unknown as Parameters<typeof standInFor>[1]);
  // As createManualOffsetDragMember starts a resize on the selection's stand-in.
  const token = beginStudioManualEditGesture(standIn, "resize");

  act(() => getApi().refreshPlayer());
  // Not swapped in place under the resize: the reload loads beside the live preview.
  const pending = getApi().previewSlots.find((slot) => slot.role === "shadow");
  expect(pending).toBeDefined();
  const gen = pending!.gen;
  const shadow = previewFrame("?_t=1");
  act(() => {
    getApi().setShadowIframeNode(shadow);
    getApi().onShadowIframeLoad(gen);
    getApi().onShadowReadyChange(gen, true);
  });
  expect(getApi().iframeRef.current).toBe(live);

  act(() => endStudioManualEditGesture(standIn, token));
  expect(getApi().iframeRef.current).toBe(shadow);

  act(() => root.unmount());
});

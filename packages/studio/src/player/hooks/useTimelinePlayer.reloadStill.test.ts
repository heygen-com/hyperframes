// @vitest-environment happy-dom
// fails without the fix: a reload kept the live page beside its own until promotion, so a heavy project held two whole
// pages (1.7x the app's resident memory on a 990-clip film) and ran out of memory. A host that can show the live
// frame as a still now gets one page at a time.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHADOW_READY_BUDGETS, SHADOW_READY_TIMEOUT_MS } from "./useShadowPreviewReload";
import { usePlayerStore } from "../store/playerStore";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../utils/gsapSoftReload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/gsapSoftReload")>()),
  ensureMotionPathPluginLoaded: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  resetPlayerStore();
});

const unmount = (root: ReturnType<typeof createRoot>) => act(() => root.unmount());

/** A loaded live preview at 3 s, and a reload asked for with `hold` as the host's still. */
async function reloadWithStill(
  hold: (live: HTMLIFrameElement) => Promise<(() => void) | null>,
  { playing = false } = {},
) {
  const harness = renderTimelinePlayerHarness({ holdPreviewStill: hold });
  const { adapter, win } = makeAdapterWindow();
  adapter.getTime = vi.fn(() => 3);
  const live = makeFakeIframe(win);
  act(() => {
    harness.getApi().iframeRef.current = live;
    harness.getApi().onIframeLoad();
  });
  if (playing) act(() => usePlayerStore.getState().setIsPlaying(true));
  await act(async () => {
    harness.getApi().refreshPlayer();
    await Promise.resolve();
  });
  return { ...harness, live, liveAdapter: adapter };
}

describe("a reload behind the host's still", () => {
  it("drops the live page before the reload's page loads, and the still once the new page shows the live time", async () => {
    const release = vi.fn();
    const hold = vi.fn(async () => release);
    const { getApi, root, live } = await reloadWithStill(hold);

    expect(hold).toHaveBeenCalledWith(live);
    const slots = getApi().previewSlots;
    expect(slots.map((slot) => slot.role)).toEqual(["shadow"]);
    expect(release).not.toHaveBeenCalled();

    const { adapter, win } = makeAdapterWindow();
    adapter.seek = vi.fn(adapter.seek);
    const next = makeFakeIframe(win);
    const gen = slots[0]!.gen;
    act(() => {
      getApi().setShadowIframeNode(next);
      getApi().onShadowIframeLoad(gen);
      getApi().onShadowReadyChange(gen, true);
    });

    expect(getApi().previewSlots).toEqual([{ gen, role: "live", url: slots[0]!.url }]);
    expect(getApi().iframeRef.current).toBe(next);
    expect(adapter.seek).toHaveBeenCalledWith(3);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    unmount(root);
  });

  it("resumes a playing preview from where the still was taken", async () => {
    const { getApi, root } = await reloadWithStill(async () => () => {}, { playing: true });
    const gen = getApi().previewSlots[0]!.gen;
    const { adapter, win } = makeAdapterWindow();
    adapter.getDuration = vi.fn(() => 10);
    adapter.seek = vi.fn(adapter.seek);
    adapter.play = vi.fn(adapter.play);
    act(() => {
      getApi().setShadowIframeNode(makeFakeIframe(win));
      getApi().onShadowIframeLoad(gen);
      getApi().onShadowReadyChange(gen, true);
    });
    expect(adapter.seek).toHaveBeenCalledWith(3);
    expect(adapter.play).toHaveBeenCalled();
    unmount(root);
  });

  it("brings the live page back at its time when the reload gives up, and drops the still once it loads", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const release = vi.fn();
    const onPreviewReloadFailed = vi.fn();
    const harness = renderTimelinePlayerHarness({
      holdPreviewStill: async () => release,
      onPreviewReloadFailed,
    });
    const { adapter, win } = makeAdapterWindow();
    adapter.getTime = vi.fn(() => 3);
    const live = makeFakeIframe(win);
    act(() => {
      harness.getApi().iframeRef.current = live;
      harness.getApi().onIframeLoad();
    });
    await act(async () => {
      harness.getApi().refreshPlayer();
      await Promise.resolve();
    });

    act(() => void vi.advanceTimersByTime(SHADOW_READY_TIMEOUT_MS * SHADOW_READY_BUDGETS));
    expect(onPreviewReloadFailed).toHaveBeenCalledWith(expect.stringContaining("too long"));
    expect(harness.getApi().previewSlots).toEqual([{ gen: 0, role: "live" }]);
    expect(release).not.toHaveBeenCalled();

    // The live slot mounts again: its new frame's load drops the still.
    const again = makeFakeIframe(makeAdapterWindow().win);
    act(() => {
      harness.getApi().iframeRef.current = again;
      vi.advanceTimersByTime(100);
    });
    act(() => {
      again.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(3_000);
    });
    expect(release).toHaveBeenCalledTimes(1);
    unmount(harness.root);
  });

  it("drops a still that answers after the composition switched, and starts no reload for the old one", async () => {
    let answer: (release: () => void) => void = () => {};
    const release = vi.fn();
    const harness = renderTimelinePlayerHarness({
      holdPreviewStill: () => new Promise((resolve) => (answer = resolve)),
    });
    const live = makeFakeIframe(makeAdapterWindow().win);
    act(() => {
      harness.getApi().iframeRef.current = live;
      harness.getApi().onIframeLoad();
    });
    act(() => harness.getApi().refreshPlayer());
    act(() => harness.getApi().resetPreviewSlots());
    await act(async () => {
      answer(release);
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(harness.getApi().previewSlots).toEqual([{ gen: 0, role: "live" }]);
    unmount(harness.root);
  });

  it("keeps both pages for a reload when the host has no still to show", async () => {
    const { getApi, root } = await reloadWithStill(async () => null);
    expect(getApi().previewSlots.map((slot) => slot.role)).toEqual(["live", "shadow"]);
    unmount(root);
  });
});

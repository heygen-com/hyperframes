import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockTimeline,
  resetRuntimeFixtureDom,
  stubDuration,
} from "./runtimeSeekFixture.test-helpers";

// A media cache refresh with no element list is a full rebuild of the clip index.
const mediaSpy = vi.hoisted(() => ({ fullRebuilds: 0 }));

vi.mock("./media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media")>();
  return {
    ...actual,
    refreshRuntimeMediaCache: (params: Parameters<typeof actual.refreshRuntimeMediaCache>[0]) => {
      if (!params?.elements) mediaSpy.fullRebuilds += 1;
      return actual.refreshRuntimeMediaCache(params);
    },
  };
});

const { initSandboxRuntimeModular } = await import("./init");

describe("timing caches across DOM edits", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const frames: FrameRequestCallback[] = [];
  const flushFrame = () => frames.splice(0, frames.length).forEach((callback) => callback(0));

  /** Full clip-index rebuilds one seek and one frame cost after `change`. */
  const rebuildsAfter = async (change: () => void): Promise<number> => {
    // Settle what init and the previous change left pending.
    window.__player?.seek(0.25);
    flushFrame();
    await Promise.resolve();
    mediaSpy.fullRebuilds = 0;
    change();
    await Promise.resolve();
    window.__player?.seek(0.5);
    flushFrame();
    return mediaSpy.fullRebuilds;
  };

  beforeEach(() => {
    resetRuntimeFixtureDom();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true">` +
      `<video id="clip" data-start="0" data-duration="4"></video>` +
      `<p class="caption">Hel</p></div>`;
    stubDuration(document.querySelector("video")!, 4);
    window.__timelines = { main: createMockTimeline(4) };
    initSandboxRuntimeModular();
    flushFrame();
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    frames.length = 0;
    delete window.__player;
    delete window.__playerReady;
  });

  it("keeps the clip index when only text changes", async () => {
    const caption = document.querySelector(".caption")!;
    expect(await rebuildsAfter(() => (caption.textContent = "Hello"))).toBe(0);
    expect(await rebuildsAfter(() => caption.append(document.createElement("span")))).toBe(0);
  });

  it("rebuilds the clip index when a clip is added or removed, or its timing changes", async () => {
    const root = document.querySelector("[data-composition-id]")!;
    expect(
      await rebuildsAfter(() => {
        const next = document.createElement("video");
        next.setAttribute("data-start", "2");
        next.setAttribute("data-duration", "1");
        stubDuration(next, 1);
        root.append(next);
      }),
    ).toBeGreaterThan(0);
    expect(await rebuildsAfter(() => document.getElementById("clip")!.remove())).toBeGreaterThan(0);
    expect(
      await rebuildsAfter(() => root.querySelector("video")!.setAttribute("data-start", "1")),
    ).toBeGreaterThan(0);
  });
});

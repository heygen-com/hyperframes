import { afterEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

type StateMsg = { type?: string; isPlaying?: boolean; playSeq?: number };

function mountRuntime(duration: number) {
  resetRuntimeFixtureDom();
  const posted: StateMsg[] = [];
  vi.spyOn(window, "postMessage").mockImplementation((msg: unknown) => {
    if (msg && typeof msg === "object" && (msg as StateMsg).type === "state") {
      posted.push(msg as StateMsg);
    }
  });
  document.body.innerHTML =
    duration > 0
      ? `<div data-composition-id="main" data-root="true" data-duration="${duration}"></div>`
      : `<div data-composition-id="main" data-root="true"></div>`;
  window.__timelines = duration > 0 ? { main: createMockTimeline(duration) } : {};
  initSandboxRuntimeModular();
  return posted;
}

function sendPlay(playSeq: number) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: { source: "hf-parent", type: "control", action: "play", playSeq },
    }),
  );
}

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
});

// fails without playSeq echo: pre-play state carries 0, handled play echoes its seq even on early return.
describe("runtime control bridge playSeq echo", () => {
  it("echoes playSeq on state messages for normal play and repeated play while playing", () => {
    const posted = mountRuntime(10);
    expect(posted.at(-1)?.isPlaying).toBe(false);
    expect(posted.at(-1)?.playSeq).toBe(0);

    posted.length = 0;
    sendPlay(2);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ isPlaying: true, playSeq: 2 });

    // Already playing: player.play() returns early, onPlay still replies with the new playSeq.
    posted.length = 0;
    sendPlay(3);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ isPlaying: true, playSeq: 3 });
  });

  it("keeps the prior playSeq on paused heartbeats until the next play control lands", () => {
    const posted = mountRuntime(10);
    expect(posted.at(-1)?.playSeq).toBe(0);

    sendPlay(2);
    posted.length = 0;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { source: "hf-parent", type: "control", action: "pause" },
      }),
    );
    expect(posted.at(-1)).toMatchObject({ isPlaying: false, playSeq: 2 });

    posted.length = 0;
    sendPlay(4);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ isPlaying: true, playSeq: 4 });
  });
});

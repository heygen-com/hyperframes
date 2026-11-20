import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Player = HTMLElement & {
  ready: boolean;
  iframeElement: HTMLIFrameElement;
  _onIframeLoad(): void;
};

/** A player whose frame is sealed as the browser seals it: its window posts, its document can't be read. */
function sealedPlayer(sealed = true) {
  const player = document.createElement("hyperframes-player") as Player;
  player.setAttribute("sandbox-origin", "");
  document.body.appendChild(player);
  const frame = player.iframeElement;
  if (sealed) Object.defineProperty(frame, "contentDocument", { value: null, configurable: true });
  const events: string[] = [];
  player.addEventListener("error", (event: Event) =>
    events.push(`error ${(event as CustomEvent<{ message?: string }>).detail?.message}`),
  );
  player.addEventListener("ready", () => events.push("ready"));
  player._onIframeLoad();
  const postTimeline = () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { source: "hf-preview", type: "timeline", durationInFrames: 120, durationSeconds: 4 },
      }),
    );
  return { player, events, postTimeline };
}

describe("a sealed film whose timeline comes after the 8 s check", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await import("./hyperframes-player.js");
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // fails without the fix: after the 8 s check gave up, the player dropped every later post from a sealed frame, so a
  // film whose runtime was ready at 10 s stayed blank until something reloaded it.
  it("shows the film when the timeline lands at 10 s", () => {
    const { player, events, postTimeline } = sealedPlayer();
    vi.advanceTimersByTime(8000);
    expect(events).toEqual(["error Composition timeline not found after 8s"]);
    vi.advanceTimersByTime(2000);
    postTimeline();
    expect(events).toEqual(["error Composition timeline not found after 8s", "ready"]);
    expect(player.ready).toBe(true);
  });

  it("a frame whose document the player reads keeps ignoring a post that comes after the check gave up", () => {
    const { player, events, postTimeline } = sealedPlayer(false);
    vi.advanceTimersByTime(8000);
    expect(events).toEqual(["error Composition timeline not found after 8s"]);
    postTimeline();
    expect(events).toEqual(["error Composition timeline not found after 8s"]);
    expect(player.ready).toBe(false);
  });
});

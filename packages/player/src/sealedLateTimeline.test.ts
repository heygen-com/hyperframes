import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLimitMs, timelineNotFound } from "./composition-probe.js";

const LIMIT = loadLimitMs();
const TIMED_OUT = `error ${timelineNotFound(LIMIT, true)}`;

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

describe("a film whose timeline comes after the load limit", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await import("./hyperframes-player.js");
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // fails without the fix: after the check gave up, the player dropped every later post from a sealed frame, so a
  // film whose runtime was ready 2 s later stayed blank until something reloaded it.
  it("shows a sealed film when the timeline lands 2 s after the limit", () => {
    const { player, events, postTimeline } = sealedPlayer();
    vi.advanceTimersByTime(LIMIT);
    expect(events).toEqual([TIMED_OUT]);
    vi.advanceTimersByTime(2000);
    postTimeline();
    expect(events).toEqual([TIMED_OUT, "ready"]);
    expect(player.ready).toBe(true);
  });

  it("shows a film whose document the player reads when its post comes after the limit", () => {
    const { player, events, postTimeline } = sealedPlayer(false);
    vi.advanceTimersByTime(LIMIT);
    expect(events).toEqual([TIMED_OUT]);
    postTimeline();
    expect(events).toEqual([TIMED_OUT, "ready"]);
    expect(player.ready).toBe(true);
  });
});

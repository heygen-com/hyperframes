import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Player = HTMLElement & {
  ready: boolean;
  duration: number;
  iframeElement: HTMLIFrameElement;
  _onIframeLoad(): void;
};

/** A player whose frame is sealed as the browser seals it: its window posts, its document can't be read. */
function framedPlayer(sealed = true) {
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
  const post = (
    data: Record<string, unknown>,
    source: MessageEventSource | null = frame.contentWindow,
  ) =>
    window.dispatchEvent(
      new MessageEvent("message", { source, data: { source: "hf-preview", ...data } }),
    );
  const postStatic = (over: Record<string, unknown> = {}, source?: MessageEventSource | null) =>
    post(
      { type: "static-composition", durationSeconds: 4, width: 1080, height: 1920, ...over },
      source,
    );
  const postTimeline = () => post({ type: "timeline", durationInFrames: 180, durationSeconds: 6 });
  return { player, events, postStatic, postTimeline };
}

describe("a sealed film whose runtime boots after the 8 s check", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await import("./hyperframes-player.js");
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // fails without the fix: a sealed player could only wait for the runtime's timeline, so a film whose runtime booted
  // at 10 s showed "Composition timeline not found after 8s" while the same film unsealed was ready from its document.
  it("is ready from its document's static read, with no 8 s error, and the runtime's timeline still lands", () => {
    const { player, events, postStatic, postTimeline } = framedPlayer();
    vi.advanceTimersByTime(1000);
    postStatic();
    expect(events).toEqual(["ready"]);
    expect(player.duration).toBe(4);
    vi.advanceTimersByTime(9000);
    expect(events).toEqual(["ready"]);
    postTimeline();
    expect(events).toEqual(["ready"]);
    expect(player.duration).toBe(6);
  });

  it.each([
    ["a duration that is not a number", { durationSeconds: Number.NaN }],
    ["an infinite duration", { durationSeconds: Number.POSITIVE_INFINITY }],
    ["a zero duration", { durationSeconds: 0 }],
    ["a negative duration", { durationSeconds: -4 }],
    ["a duration past the bound", { durationSeconds: 1e9 }],
    ["a duration sent as text", { durationSeconds: "4" }],
    ["a width that is not a whole positive number", { width: 0.5 }],
    ["a height past the bound", { height: 1e7 }],
  ])("ignores a static read with %s", (_name, over) => {
    const { player, events, postStatic } = framedPlayer();
    postStatic(over);
    vi.advanceTimersByTime(8000);
    expect(events).toEqual(["error Composition timeline not found after 8s"]);
    expect(player.ready).toBe(false);
  });

  it("ignores a static read posted by any window but its own frame", () => {
    const { player, events, postStatic } = framedPlayer();
    postStatic({}, window);
    vi.advanceTimersByTime(8000);
    expect(events).toEqual(["error Composition timeline not found after 8s"]);
    expect(player.ready).toBe(false);
  });

  it("a frame whose document the player reads keeps its own probe and ignores the post", () => {
    const { player, events, postStatic } = framedPlayer(false);
    postStatic();
    expect(events).toEqual([]);
    expect(player.ready).toBe(false);
  });
});

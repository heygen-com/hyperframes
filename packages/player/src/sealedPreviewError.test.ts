import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLimitMs, timelineNotFound } from "./composition-probe.js";

const LIMIT = loadLimitMs();
const THROWN = "Uncaught TypeError: Cannot set properties of undefined (setting 'main')";

type Player = HTMLElement & {
  ready: boolean;
  iframeElement: HTMLIFrameElement;
  _onIframeLoad(): void;
};

/** A sealed player whose frame posts but can't be read, its load under way. */
function sealedPlayer() {
  const player = document.createElement("hyperframes-player") as Player;
  player.setAttribute("sandbox-origin", "");
  document.body.appendChild(player);
  const frame = player.iframeElement;
  Object.defineProperty(frame, "contentDocument", { value: null, configurable: true });
  const events: string[] = [];
  player.addEventListener("error", (event: Event) =>
    events.push(`error ${(event as CustomEvent<{ message?: string }>).detail?.message}`),
  );
  player.addEventListener("ready", () => events.push("ready"));
  player._onIframeLoad();
  const post = (data: Record<string, unknown>, source: Window | null = frame.contentWindow) =>
    window.dispatchEvent(
      new MessageEvent("message", { source, data: { source: "hf-preview", ...data } }),
    );
  const postError = (message: unknown, source?: Window | null) =>
    post({ type: "preview-error", message }, source);
  return { player, events, post, postError };
}

describe("an error a sealed frame's preview records", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await import("./hyperframes-player.js");
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // fails without the fix: the sealed player could not read the frame's recorded error, so a preview whose runtime
  // failed to load waited out the load limit and then blamed the composition for a missing runtime.
  it("fails the load at once with the frame's own text, as an unsealed player reads it", () => {
    const { events, postError } = sealedPlayer();
    postError(THROWN);
    postError("a later error");
    expect(events).toEqual([`error ${THROWN}`]);
    vi.advanceTimersByTime(LIMIT);
    expect(events).toEqual([`error ${THROWN}`]);
  });

  it("ignores an error posted by any window but its own frame", () => {
    const { events, postError } = sealedPlayer();
    postError(THROWN, window);
    vi.advanceTimersByTime(LIMIT);
    expect(events).toEqual([`error ${timelineNotFound(LIMIT)}`]);
  });

  it("ignores an error once the film is ready", () => {
    const { player, events, post, postError } = sealedPlayer();
    post({ type: "timeline", durationInFrames: 120, durationSeconds: 4 });
    postError(THROWN);
    expect(events).toEqual(["ready"]);
    expect(player.ready).toBe(true);
  });

  it.each([
    ["a number", 42],
    ["an object", { toString: () => THROWN }],
    ["blank text", "  "],
  ])("ignores %s in place of the error's text", (_name, message) => {
    const { events, postError } = sealedPlayer();
    postError(message);
    vi.advanceTimersByTime(LIMIT);
    expect(events).toEqual([`error ${timelineNotFound(LIMIT)}`]);
  });

  it("keeps the first 1000 characters of a longer text, as plain text", () => {
    const { events, postError } = sealedPlayer();
    postError(`<b>${"x".repeat(2000)}`);
    expect(events).toEqual([`error <b>${"x".repeat(997)}`]);
  });
});

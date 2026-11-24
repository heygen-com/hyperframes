import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLimitMs, timelineNotFound } from "./composition-probe.js";

type Player = HTMLElement & { iframeElement: HTMLIFrameElement; _onIframeLoad(): void };

const LIMIT = loadLimitMs();
const PLAIN = timelineNotFound(LIMIT);
const HINTED = timelineNotFound(LIMIT, true);

const unheard = (warn: { mock: { calls: unknown[][] } }) =>
  warn.mock.calls.filter(([text]) => String(text).includes("error with no listener")).length;

/** A player whose film's frame can't be read, as a frame from another site, or a sealed one, can't be. */
function load(src: string, { sealed, listen = true }: { sealed: boolean; listen?: boolean }) {
  const player = document.createElement("hyperframes-player") as Player;
  if (sealed) player.setAttribute("sandbox-origin", "");
  player.setAttribute("src", src);
  document.body.appendChild(player);
  Object.defineProperty(player.iframeElement, "contentDocument", {
    value: null,
    configurable: true,
  });
  const errors: string[] = [];
  if (listen) {
    player.addEventListener("error", (event: Event) =>
      errors.push((event as CustomEvent<{ message: string }>).detail.message),
    );
  }
  player._onIframeLoad();
  return { player, errors };
}

describe("the timeline timeout", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await import("./hyperframes-player.js");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // fails without the fix: the error said only that no timeline was found, not that the film must bring the runtime.
  it.each([true, false])(
    "names the fix for a film from another site, the same sealed or not (sealed: %s)",
    (sealed) => {
      const { errors } = load("https://films.example/film.html", { sealed });
      vi.advanceTimersByTime(LIMIT);
      expect(errors).toEqual([HINTED]);
    },
  );

  it.each([true, false])(
    "keeps the plain timeout for a film from the page's own site (sealed: %s)",
    (sealed) => {
      const { errors } = load(`${location.origin}/film.html`, { sealed });
      vi.advanceTimersByTime(LIMIT);
      expect(errors).toEqual([PLAIN]);
    },
  );

  // fails without the fix: an error nobody listened for left the console silent.
  it.each([true, false])(
    "warns in the console when nothing listens for the error (sealed: %s)",
    (sealed) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      load("https://films.example/film.html", { sealed, listen: false });
      vi.advanceTimersByTime(LIMIT);
      // The composition URL can carry a signed query, so the warning names only the error.
      expect(warn).toHaveBeenCalledWith(`[hyperframes-player] error with no listener: ${HINTED}`);
    },
  );

  it("warns for the next error once a once-listener has heard one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { player } = load("https://films.example/film.html", { sealed: true, listen: false });
    player.addEventListener("error", () => {}, { once: true });
    vi.advanceTimersByTime(LIMIT);
    expect(unheard(warn)).toBe(0);
    player._onIframeLoad();
    vi.advanceTimersByTime(LIMIT);
    expect(unheard(warn)).toBe(1);
  });

  it("keeps a listener added with and without capture until both are removed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { player } = load("https://films.example/film.html", { sealed: true, listen: false });
    const heard = vi.fn();
    player.addEventListener("error", heard, true);
    player.addEventListener("error", heard);
    player.removeEventListener("error", heard);
    vi.advanceTimersByTime(LIMIT);
    expect(heard).toHaveBeenCalledOnce();
    expect(unheard(warn)).toBe(0);
  });

  it("warns once the signal that added the only listener aborts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { player } = load("https://films.example/film.html", { sealed: true, listen: false });
    const added = new AbortController();
    player.addEventListener("error", () => {}, { signal: added.signal });
    added.abort();
    vi.advanceTimersByTime(LIMIT);
    expect(unheard(warn)).toBe(1);
  });

  it("does not warn when an onerror handler hears the error and clears itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { player } = load("https://films.example/film.html", { sealed: true, listen: false });
    const handled = vi.fn(() => (player.onerror = null));
    player.onerror = handled;
    vi.advanceTimersByTime(LIMIT);
    expect(handled).toHaveBeenCalledOnce();
    expect(unheard(warn)).toBe(0);
  });

  it.each([
    ["an error listener", (player: Player) => player.addEventListener("error", () => {})],
    ["onerror", (player: Player) => (player.onerror = () => {})],
  ])("does not warn when the page handles the error with %s", (_name, handle) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { player } = load("https://films.example/film.html", { sealed: true, listen: false });
    handle(player);
    vi.advanceTimersByTime(LIMIT);
    expect(
      warn.mock.calls.filter(([text]) => String(text).includes("error with no listener")),
    ).toEqual([]);
  });
});

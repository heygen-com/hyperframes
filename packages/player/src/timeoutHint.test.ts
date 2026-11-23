import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Player = HTMLElement & { iframeElement: HTMLIFrameElement; _onIframeLoad(): void };

const PLAIN = "Composition timeline not found after 8s";
const HINTED = `${PLAIN}. A player can't add the HyperFrames runtime to a composition from another site: include the runtime script in it.`;

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

  // fails without the fix: the error said only that no timeline was found, for a film whose fix is to include the runtime.
  it.each([true, false])(
    "names the fix for a film from another site, the same sealed or not (sealed: %s)",
    (sealed) => {
      const { errors } = load("https://films.example/film.html", { sealed });
      vi.advanceTimersByTime(8000);
      expect(errors).toEqual([HINTED]);
    },
  );

  it.each([true, false])(
    "keeps the plain timeout for a film from the page's own site (sealed: %s)",
    (sealed) => {
      const { errors } = load(`${location.origin}/film.html`, { sealed });
      vi.advanceTimersByTime(8000);
      expect(errors).toEqual([PLAIN]);
    },
  );

  // fails without the fix: an error nobody listened for left the console silent.
  it.each([true, false])(
    "warns in the console when nothing listens for the error (sealed: %s)",
    (sealed) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      load("https://films.example/film.html", { sealed, listen: false });
      vi.advanceTimersByTime(8000);
      expect(warn).toHaveBeenCalledWith(`[hyperframes-player] error with no listener: ${HINTED}`, {
        src: "https://films.example/film.html",
      });
    },
  );

  it.each([
    ["an error listener", (player: Player) => player.addEventListener("error", () => {})],
    ["onerror", (player: Player) => (player.onerror = () => {})],
  ])("does not warn when the page handles the error with %s", (_name, handle) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { player } = load("https://films.example/film.html", { sealed: true, listen: false });
    handle(player);
    vi.advanceTimersByTime(8000);
    expect(
      warn.mock.calls.filter(([text]) => String(text).includes("error with no listener")),
    ).toEqual([]);
  });
});

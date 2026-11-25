import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositionProbe, loadLimitMs } from "./composition-probe.js";
import type { HyperframesPlayer } from "./hyperframes-player.js";

describe("loadLimitMs", () => {
  it.each([
    [{ userAgentData: { platform: "Windows" }, userAgent: "" }, 90_000],
    [{ userAgentData: { platform: "macOS" }, userAgent: "" }, 120_000],
    [{ userAgentData: { platform: "Linux" }, userAgent: "" }, 30_000],
    [{ userAgentData: { platform: "Chrome OS" }, userAgent: "" }, 120_000],
    [{ userAgentData: { platform: "Android" }, userAgent: "" }, 120_000],
    [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0" }, 90_000],
    [{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15" }, 120_000],
    [{ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0" }, 30_000],
    [{ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/131.0" }, 120_000],
    [{ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0" }, 120_000],
    [{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1" }, 120_000],
    [{ userAgent: "" }, 120_000],
  ])("gives %o %i ms", (nav, limit) => {
    expect(loadLimitMs(nav)).toBe(limit);
  });
});

describe("a film past its load limit", () => {
  beforeEach(async () => {
    await import("./hyperframes-player.js");
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const LINUX = 30_000;

  function openFrame() {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = '<div data-composition-id="main"></div>';
    const onReady = vi.fn();
    const onError = vi.fn();
    const probe = new CompositionProbe(iframe, { onReady, onError });
    probe.start();
    return { win: iframe.contentWindow!, onReady, onError };
  }

  function mountPlayer() {
    const player = document.createElement("hyperframes-player") as HyperframesPlayer;
    document.body.appendChild(player);
    const iframe = player.shadowRoot!.querySelector("iframe")!;
    iframe.contentDocument!.body.innerHTML = '<div data-composition-id="main"></div>';
    const events: string[] = [];
    const readies: Array<{ readyMs: number | null; loadLimitMs: number | null }> = [];
    player.addEventListener("error", (event: Event) =>
      events.push(`error ${(event as CustomEvent<{ message: string }>).detail.message}`),
    );
    player.addEventListener("ready", (event) => {
      events.push("ready");
      readies.push((event as CustomEvent<(typeof readies)[number]>).detail);
    });
    iframe.dispatchEvent(new Event("load"));
    const postTimeline = () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { source: "hf-preview", type: "timeline", durationInFrames: 120 },
        }),
      );
    return { player, events, readies, postTimeline };
  }

  it("is still loading at 8 s and fails once at the system's limit, naming it", () => {
    expect(loadLimitMs()).toBe(LINUX);
    const { onError } = openFrame();
    vi.advanceTimersByTime(8_000);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LINUX - 8_000);
    expect(onError).toHaveBeenCalledExactlyOnceWith("Composition timeline not found after 30s");
    vi.advanceTimersByTime(LINUX);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("still resolves a timeline its document gets after the limit", () => {
    const { win, onReady, onError } = openFrame();
    vi.advanceTimersByTime(LINUX + 10_000);
    expect(onError).toHaveBeenCalledOnce();
    Object.assign(win, { __player: { getDuration: () => 6 } });
    vi.advanceTimersByTime(1_000);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0].duration).toBe(6);
  });

  it("fires ready for a timeline posted after the limit, after its error", () => {
    const { player, events, postTimeline } = mountPlayer();
    vi.advanceTimersByTime(LINUX);
    postTimeline();
    expect(events).toEqual(["error Composition timeline not found after 30s", "ready"]);
    expect(player.ready).toBe(true);
  });

  it("reads the document five times a second until the limit, then once a second", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = '<div data-composition-id="main"></div>';
    const probe = new CompositionProbe(iframe, { onReady: vi.fn(), onError: vi.fn() });
    const reads = vi.spyOn(iframe, "contentDocument", "get");
    probe.start();
    const readsOver = (ms: number) => {
      const from = reads.mock.calls.length;
      vi.advanceTimersByTime(ms);
      return reads.mock.calls.length - from;
    };
    vi.advanceTimersByTime(10_000);
    const early = readsOver(2_000);
    vi.advanceTimersByTime(LINUX - 12_000 + 2_000);
    expect(readsOver(2_000) * 5).toBe(early);
    probe.stop();
  });

  it("stops reading a film past its limit once the player leaves the page", () => {
    const { player } = mountPlayer();
    vi.advanceTimersByTime(LINUX + 2_000);
    const reads = vi.spyOn(player.iframeElement, "contentDocument", "get");
    player.remove();
    const after = reads.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(reads.mock.calls.length).toBe(after);
  });

  it("fails at the limit by the clock when a throttled tab polls less often", () => {
    const { onError } = openFrame();
    vi.advanceTimersByTime(400);
    const now = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(now + LINUX);
    vi.advanceTimersByTime(200);
    expect(onError).toHaveBeenCalledExactlyOnceWith("Composition timeline not found after 30s");
  });

  function navigatedPlayer() {
    const player = document.createElement("hyperframes-player") as HyperframesPlayer;
    player.setAttribute("src", "film-1.html");
    document.body.appendChild(player);
    const iframe = player.shadowRoot!.querySelector("iframe")!;
    const readies: Array<{ readyMs: number | null; loadLimitMs: number | null }> = [];
    player.addEventListener("ready", (event) =>
      readies.push((event as CustomEvent<(typeof readies)[number]>).detail),
    );
    const postTimeline = () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { source: "hf-preview", type: "timeline", durationInFrames: 120 },
        }),
      );
    return { player, iframe, readies, postTimeline };
  }

  it("times a timeline posted before load from the navigation, with the limit it had", () => {
    const { readies, postTimeline } = navigatedPlayer();
    vi.advanceTimersByTime(1_200);
    postTimeline();
    expect(readies).toEqual([expect.objectContaining({ readyMs: 1_200, loadLimitMs: LINUX })]);
  });

  it("times each later film from its own navigation", () => {
    const { player, iframe, readies, postTimeline } = navigatedPlayer();
    vi.advanceTimersByTime(1_200);
    iframe.dispatchEvent(new Event("load"));
    postTimeline();
    vi.advanceTimersByTime(4_000);
    player.setAttribute("src", "film-2.html");
    vi.advanceTimersByTime(500);
    postTimeline();
    expect(readies.map((ready) => ready.readyMs)).toEqual([1_200, 500]);
  });

  it("times the film a removed srcdoc falls back to from that removal", () => {
    const { player, readies, postTimeline } = navigatedPlayer();
    player.setAttribute("srcdoc", "<p>draft</p>");
    vi.advanceTimersByTime(4_000);
    player.removeAttribute("srcdoc");
    vi.advanceTimersByTime(700);
    postTimeline();
    expect(readies.map((ready) => ready.readyMs)).toEqual([700]);
  });

  // fails without the fix: a timeline posted before load left the navigation marked, so the next document the frame
  // opened itself was timed from that old navigation.
  it("reports no load time for a document the frame opens after a film that was ready before load", () => {
    const { iframe, readies, postTimeline } = navigatedPlayer();
    vi.advanceTimersByTime(1_200);
    postTimeline();
    iframe.dispatchEvent(new Event("load"));
    vi.spyOn(iframe, "contentDocument", "get").mockReturnValue(
      document.implementation.createHTMLDocument(),
    );
    vi.advanceTimersByTime(4_000);
    iframe.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(300);
    postTimeline();
    expect(readies.map((ready) => ready.readyMs)).toEqual([1_200, null]);
  });

  it("reports no load time for a document the frame opened itself", () => {
    const { readies, postTimeline } = mountPlayer();
    vi.advanceTimersByTime(1_200);
    postTimeline();
    expect(readies).toEqual([expect.objectContaining({ readyMs: null, loadLimitMs: LINUX })]);
  });
});

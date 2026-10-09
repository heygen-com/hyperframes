import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HyperframesPlayer } from "./hyperframes-player.js";
import { RUNTIME_CDN_URL } from "./runtime-url.js";

function mountPlayer() {
  const player = document.createElement("hyperframes-player") as HyperframesPlayer;
  document.body.appendChild(player);
  const iframe = player.shadowRoot!.querySelector("iframe")!;
  iframe.contentDocument!.body.innerHTML =
    '<div data-composition-id="main"><div data-composition-src="child.html"></div></div>';
  const onError = vi.fn();
  const onReady = vi.fn();
  player.addEventListener("error", onError);
  player.addEventListener("ready", onReady);
  iframe.dispatchEvent(new Event("load"));
  return { player, iframe, onError, onReady };
}

function sendTimeline(iframe: HTMLIFrameElement) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      data: { source: "hf-preview", type: "timeline", durationInFrames: 270, scenes: [] },
    }),
  );
}

function keepDocument(iframe: HTMLIFrameElement, doc: Document | null) {
  Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => doc });
}

function expectUnready(player: HyperframesPlayer, onReady: ReturnType<typeof vi.fn>) {
  expect(onReady).not.toHaveBeenCalled();
  expect(player.ready).toBe(false);
  expect(player.duration).toBe(0);
}

function expectTimelineReady(player: HyperframesPlayer, onReady: ReturnType<typeof vi.fn>) {
  expect(onReady).toHaveBeenCalledOnce();
  expect(player.ready).toBe(true);
  expect(player.duration).toBe(9);
}

describe("terminal probe readiness", () => {
  beforeEach(async () => {
    await import("./hyperframes-player.js");
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not accept a runtime timeline message after the probe timed out", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    vi.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    sendTimeline(iframe);
    expectUnready(player, onReady);
  });

  it("rejects the failed document while its replacement is still navigating", () => {
    const { player, iframe, onReady } = mountPlayer();
    vi.advanceTimersByTime(8000);
    keepDocument(iframe, iframe.contentDocument);
    player.setAttribute("src", "next.html");
    sendTimeline(iframe);
    expectUnready(player, onReady);
  });

  it("accepts the replacement document handshake before its load event", () => {
    const { player, iframe, onReady } = mountPlayer();
    vi.advanceTimersByTime(8000);
    keepDocument(iframe, iframe.contentDocument);
    player.setAttribute("src", "next.html");
    const replacement = document.implementation.createHTMLDocument("Replacement");
    keepDocument(iframe, replacement);
    sendTimeline(iframe);
    expectTimelineReady(player, onReady);
  });

  it("keeps an opaque document failure latched until its next load event", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    keepDocument(iframe, null);
    vi.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledOnce();
    player.setAttribute("src", "https://example.org/next.html");
    sendTimeline(iframe);
    expect(onReady).not.toHaveBeenCalled();
    expect(player.ready).toBe(false);
    iframe.dispatchEvent(new Event("load"));
    sendTimeline(iframe);
    expectTimelineReady(player, onReady);
  });

  it("does not accept a runtime handshake after reporting an author error", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    Object.assign(iframe.contentWindow!, { __hfPreviewErrors: ["Uncaught Error: author failed"] });
    vi.advanceTimersByTime(200);
    expect(onError.mock.calls[0][0].detail.message).toBe("Uncaught Error: author failed");
    sendTimeline(iframe);
    expectUnready(player, onReady);
  });

  it.each([
    ["http://127.0.0.1:8900/custom-runtime.js", "http://127.0.0.1:8900/custom-runtime.js"],
    ["/custom-runtime.js", "http://localhost:3000/custom-runtime.js"],
    ["https://foreign.example/custom-runtime.js", null],
    ['javascript:alert("no")', null],
  ])("resolves runtime-src %s for a src embed", (configured, expected) => {
    const { player, iframe } = mountPlayer();
    player.setAttribute("runtime-src", configured);
    player.setAttribute("src", "composition.html");
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("missing fixture document");
    doc.body.innerHTML =
      '<div data-composition-id="main"><div data-composition-src="child.html"></div></div>';
    iframe.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(200);
    const script = iframe.contentDocument?.querySelector("script[src]");
    if (!(script instanceof HTMLScriptElement)) throw new Error("missing injected runtime");
    expect(script.src).toBe(expected ?? RUNTIME_CDN_URL);
  });

  it("rejects a late runtime handshake after a load failure", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    vi.advanceTimersByTime(200);
    const script = iframe.contentDocument?.querySelector("script[src]");
    if (!(script instanceof HTMLScriptElement)) throw new Error("missing injected runtime");
    script.dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledOnce();
    sendTimeline(iframe);
    expectUnready(player, onReady);
  });

  it("can recover from a load failure in the next document", () => {
    const { player, iframe, onReady } = mountPlayer();
    vi.advanceTimersByTime(200);
    const script = iframe.contentDocument?.querySelector("script[src]");
    if (!(script instanceof HTMLScriptElement)) throw new Error("missing injected runtime");
    script.dispatchEvent(new Event("error"));
    const replacement = document.implementation.createHTMLDocument("Replacement");
    keepDocument(iframe, replacement);
    iframe.dispatchEvent(new Event("load"));
    sendTimeline(iframe);
    expectTimelineReady(player, onReady);
  });
});

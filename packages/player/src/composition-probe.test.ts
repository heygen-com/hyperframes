import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompositionProbe,
  readCompositionSizeFromDocument,
  runtimeCdnUrlForVersion,
} from "./composition-probe.js";
import { RUNTIME_CDN_URL } from "./runtime-url.js";

describe("readCompositionSizeFromDocument", () => {
  it("reads dimensions from the composition root", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML =
      '<div data-composition-id="main" data-width="1080" data-height="1920"></div>';

    expect(readCompositionSizeFromDocument(doc)).toEqual({ width: 1080, height: 1920 });
  });

  it("falls back to plain data-width/data-height compositions", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div class="clip" data-width="1080" data-height="1920"></div>';

    expect(readCompositionSizeFromDocument(doc)).toEqual({ width: 1080, height: 1920 });
  });

  it("ignores invalid dimensions", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div data-width="0" data-height="1920"></div>';

    expect(readCompositionSizeFromDocument(doc)).toBeNull();
  });
});

describe("runtimeCdnUrlForVersion", () => {
  it("pins the injected core runtime to the Player-compatible version", () => {
    expect(runtimeCdnUrlForVersion("1.2.3")).toBe(
      "https://cdn.jsdelivr.net/npm/@hyperframes/core@1.2.3/dist/hyperframe.runtime.iife.js",
    );
  });

  it("rejects values that could create an unversioned or malformed URL", () => {
    expect(() => runtimeCdnUrlForVersion("latest")).toThrow("Invalid HyperFrames runtime version");
  });
});

// ── Runtime detection and injection ──
//
// `window.__hf` is a namespace, not a bridge. The core runtime creates it, but
// so does `@hyperframes/shader-transitions` (to publish `shaderTransitionsReady`),
// so an authored composition that uses shader transitions and registers its
// own `__timelines` carries `__hf` with no runtime behind it. The probe used
// to read that as "runtime present": it never injected the runtime, refused
// the direct-timeline adapter, and the embed timed out after 8 s. The only
// global the player ever drives is `__player`, so that is the bridge check.
describe("CompositionProbe runtime detection", () => {
  type FakeTimeline = {
    duration: () => number;
    time: () => number;
    seek: () => void;
    play: () => void;
    pause: () => void;
  };
  type FakeWindow = {
    __hf?: unknown;
    __player?: unknown;
    __timelines?: Record<string, FakeTimeline>;
  };
  type FakeScript = { src: string; onerror: (() => void) | null };

  function fakeTimeline(duration = 10): FakeTimeline {
    return { duration: () => duration, time: () => 0, seek() {}, play() {}, pause() {} };
  }

  // A minimal contentDocument so injection does not go through happy-dom's
  // real `<script src>` loading. `appendChild` records the injected script.
  function fakeDocument(bodyHtml: string, appended: FakeScript[]) {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = bodyHtml;
    return {
      querySelector: (selector: string) => doc.querySelector(selector),
      createElement: (): FakeScript => ({ src: "", onerror: null }),
      head: { appendChild: (node: FakeScript) => appended.push(node) },
    };
  }

  function fakeIframe(win: FakeWindow, doc: unknown): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => win });
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => doc });
    return iframe;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drives __timelines directly when only the shader-transitions __hf namespace is present", () => {
    const appended: FakeScript[] = [];
    const win: FakeWindow = {
      __hf: { shaderTransitionsReady: Promise.resolve() },
      __timelines: { main: fakeTimeline(10) },
    };
    const iframe = fakeIframe(
      win,
      fakeDocument(
        '<div data-composition-id="main" data-width="1080" data-height="1920"></div>',
        appended,
      ),
    );
    const onReady = vi.fn();
    const onError = vi.fn();
    const probe = new CompositionProbe(iframe, { onReady, onError });

    probe.start();
    vi.advanceTimersByTime(200);

    expect(onError).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toMatchObject({
      duration: 10,
      adapter: { kind: "direct-timeline" },
    });
    expect(probe.hasRuntimeBridge(win as unknown as Window)).toBe(false);
    probe.stop();
  });

  it("still prefers an installed __player bridge over direct __timelines", () => {
    const win: FakeWindow = {
      __hf: {},
      __player: { getDuration: () => 7 },
      __timelines: { main: fakeTimeline(10) },
    };
    const iframe = fakeIframe(win, fakeDocument("", []));
    const onReady = vi.fn();
    const probe = new CompositionProbe(iframe, { onReady, onError: vi.fn() });

    probe.start();
    vi.advanceTimersByTime(200);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toMatchObject({ duration: 7, adapter: { kind: "runtime" } });
    expect(probe.hasRuntimeBridge(win as unknown as Window)).toBe(true);
    expect(probe.resolveDirectTimelineAdapter()).toBeNull();
    probe.stop();
  });

  it("injects the runtime into a nested composition despite a pre-existing __hf namespace", () => {
    const appended: FakeScript[] = [];
    const win: FakeWindow = { __hf: { shaderTransitionsReady: Promise.resolve() } };
    const iframe = fakeIframe(
      win,
      fakeDocument('<div data-composition-src="child.html"></div>', appended),
    );
    const onRuntimeInjected = vi.fn();
    const probe = new CompositionProbe(iframe, {
      onReady: vi.fn(),
      onError: vi.fn(),
      onRuntimeInjected,
    });

    probe.start();
    vi.advanceTimersByTime(200);

    expect(onRuntimeInjected).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe(RUNTIME_CDN_URL);
    probe.stop();
  });

  it("loads the runtime from resolveRuntimeUrl when the host configures one", () => {
    // `runtime-src` was honoured for srcdoc only; an src embed always fetched
    // the runtime from jsDelivr, which fails offline or under a strict CSP.
    const appended: FakeScript[] = [];
    const iframe = fakeIframe(
      {},
      fakeDocument('<div data-composition-src="child.html"></div>', appended),
    );
    const probe = new CompositionProbe(iframe, {
      onReady: vi.fn(),
      onError: vi.fn(),
      resolveRuntimeUrl: () => "http://127.0.0.1:8900/hyperframe.runtime.iife.js",
    });

    probe.start();
    vi.advanceTimersByTime(200);

    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("http://127.0.0.1:8900/hyperframe.runtime.iife.js");
    probe.stop();
  });

  it("reports a runtime that fails to load instead of waiting out the 8 s timeout", () => {
    const appended: FakeScript[] = [];
    const iframe = fakeIframe(
      {},
      fakeDocument('<div data-composition-src="child.html"></div>', appended),
    );
    const onError = vi.fn();
    const probe = new CompositionProbe(iframe, {
      onReady: vi.fn(),
      onError,
      resolveRuntimeUrl: () => "http://127.0.0.1:8900/missing.js",
    });

    probe.start();
    vi.advanceTimersByTime(200);
    expect(appended).toHaveLength(1);

    appended[0].onerror?.();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "HyperFrames runtime failed to load from http://127.0.0.1:8900/missing.js",
    );

    // The probe has stopped: no second, generic timeout error follows.
    vi.advanceTimersByTime(10_000);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

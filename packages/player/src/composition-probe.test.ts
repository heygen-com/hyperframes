import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompositionProbe,
  type ProbeCallbacks,
  readCompositionSizeFromDocument,
  runtimeCdnUrlForVersion,
} from "./composition-probe.js";

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

describe("src embed runtime discovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const root = '<div data-composition-id="main" data-width="640" data-height="360"></div>';
  const nested =
    '<div data-composition-id="main"><div data-composition-src="child.html"></div></div>';
  const timeline = {
    duration: () => 2,
    time: () => 0,
    seek: () => {},
    play: () => {},
    pause: () => {},
  };

  function mount(
    markup: string,
    globals: Record<string, unknown> = {},
    callbacks: Partial<ProbeCallbacks> = {},
  ) {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("missing fixture document");
    doc.body.innerHTML = markup;
    Object.assign(win, globals);
    const onReady = vi.fn();
    const onError = vi.fn();
    const probe = new CompositionProbe(iframe, { ...callbacks, onReady, onError });
    probe.start();
    return { iframe, doc, win, probe, onReady, onError };
  }

  function injectedScript(doc: Document) {
    const script = doc.querySelector("script[src]");
    if (!(script instanceof HTMLScriptElement)) throw new Error("runtime script was not injected");
    return script;
  }

  it.each([{}, { shaderTransitionsReady: Promise.resolve() }, { seek: () => {} }, null])(
    "drives an authored timeline beside the shared __hf namespace %s",
    (namespace) => {
      const { onReady, onError } = mount(root, {
        __hf: namespace,
        __timelines: { main: timeline },
      });
      vi.advanceTimersByTime(200);
      expect(onReady).toHaveBeenCalledOnce();
      expect(onReady.mock.calls[0][0].adapter).toMatchObject({ kind: "direct-timeline", timeline });
      expect(onReady.mock.calls[0][0].duration).toBe(2);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it("keeps the runtime bridge ahead of authored timelines", () => {
    const { doc, onReady } = mount(root, {
      __hf: {},
      __player: { getDuration: () => 5 },
      __timelines: { main: timeline },
    });
    vi.advanceTimersByTime(200);
    expect(onReady.mock.calls[0][0]).toMatchObject({ duration: 5, adapter: { kind: "runtime" } });
    expect(doc.querySelector("script")).toBeNull();
  });

  it("injects the runtime for nested scenes even when shaders created __hf", () => {
    const { doc, onReady } = mount(nested, {
      __hf: { shaderTransitionsReady: Promise.resolve() },
      __timelines: { main: timeline },
    });
    vi.advanceTimersByTime(200);
    expect(injectedScript(doc).src).toContain("hyperframe.runtime.iife.js");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("uses the configured URL at injection time", () => {
    let url = "http://127.0.0.1:8000/first.js";
    const { doc } = mount(nested, {}, { resolveRuntimeUrl: () => url });
    url = "http://127.0.0.1:8000/current.js";
    vi.advanceTimersByTime(200);
    expect(injectedScript(doc).src).toBe(url);
  });

  it("reports a failed runtime load once and latches the failed document", () => {
    const url = "http://127.0.0.1:8000/missing-runtime.js";
    const { doc, probe, onError, onReady } = mount(nested, {}, { resolveRuntimeUrl: () => url });
    vi.advanceTimersByTime(200);
    injectedScript(doc).dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      "HyperFrames runtime failed to load from " + url,
    );
    expect(probe.failed).toBe(true);
    vi.advanceTimersByTime(16000);
    expect(onError).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("ignores a script error after the probe stopped", () => {
    const { doc, probe, onError } = mount(nested);
    vi.advanceTimersByTime(200);
    const oldScript = injectedScript(doc);
    probe.stop();
    oldScript.dispatchEvent(new Event("error"));
    expect(onError).not.toHaveBeenCalled();
    expect(probe.failed).toBe(false);
  });

  it("does not let an old script error fail a restarted probe", () => {
    const { doc, probe, win, onReady, onError } = mount(nested);
    vi.advanceTimersByTime(200);
    const oldScript = injectedScript(doc);
    probe.start();
    oldScript.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(200);
    Object.assign(win, { __player: { getDuration: () => 2 } });
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(probe.failed).toBe(false);
  });
});

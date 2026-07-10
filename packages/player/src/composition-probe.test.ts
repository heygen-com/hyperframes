import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositionProbe, readCompositionSizeFromDocument } from "./composition-probe.js";

const DEFAULT_RUNTIME_URL =
  "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";

/** A same-origin iframe whose contentDocument/contentWindow are overridden
 *  with mock objects rather than a real navigation — the pattern the rest of
 *  this file already uses for direct-timeline resolution tests. */
function makeMockIframe(src: string, bodyHtml: string) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.setAttribute("src", src);

  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = bodyHtml;

  const win = Object.create(window) as Window & Record<string, unknown>;
  Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => doc });
  Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => win });

  return { iframe, doc, win };
}

const COMPOSITION_ROOT =
  '<div data-composition-id="main" data-width="1920" data-height="1080"></div>';

/** An iframe whose src has "loaded" a document with no runtime bridge, no
 *  __timelines, and an inline script that references `hyperframesAnime` (the
 *  raw anime.js composition shape) — the exact scenario pre-parse injection
 *  targets. */
function makeRawAnimeIframe(src: string) {
  return makeMockIframe(
    src,
    `${COMPOSITION_ROOT}<script>hyperframesAnime.register("main", {}, {});</script>`,
  );
}

/** An iframe whose src has "loaded" a document that already self-bootstraps
 *  `window.__timelines` (the GSAP shape) — never references `hyperframesAnime`,
 *  so pre-parse injection must leave it alone. */
function makeRawGsapIframe(src: string) {
  return makeMockIframe(
    src,
    `${COMPOSITION_ROOT}<script>window.__timelines = window.__timelines || {};</script>`,
  );
}

function stubFetchResolved(response: { ok: boolean; status?: number; body: string }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    text: () => Promise.resolve(response.body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchNeverCalled() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NOOP_CALLBACKS = { onReady: () => undefined, onError: () => undefined };

async function startAndTick(probe: CompositionProbe): Promise<void> {
  probe.start();
  await vi.advanceTimersByTimeAsync(200);
}

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

describe("CompositionProbe direct timeline resolution", () => {
  it("resolves a same-origin anime registration without injecting the runtime bridge", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    try {
      const doc = document.implementation.createHTMLDocument();
      Object.defineProperty(iframe, "contentDocument", {
        configurable: true,
        get() {
          return doc;
        },
      });
      doc.body.innerHTML =
        '<div data-composition-id="main" data-width="1080" data-height="1920"></div>';
      const seek = vi.fn();
      const win = Object.create(window);
      Reflect.set(win, "__hfAnime", {
        main: {
          id: "main",
          instance: {
            seek,
            duration: 2500,
            play: vi.fn(),
            pause: vi.fn(),
          },
          labels: {},
        },
      });

      const probe = new CompositionProbe(iframe, {
        onReady: () => undefined,
        onError: () => undefined,
      });
      const adapter = probe.resolveDirectTimelineAdapterFromWindow(win);
      if (!adapter) throw new Error("expected direct anime adapter");

      expect(adapter.duration()).toBe(2.5);
      adapter.seek(1.2, false);
      expect(seek).toHaveBeenCalledWith(1200);
      expect(adapter.time()).toBe(1.2);
    } finally {
      iframe.remove();
    }
  });
});

describe("CompositionProbe pre-parse runtime injection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches the raw anime src, injects the runtime script + base tag, and reloads via srcdoc", async () => {
    const src = "https://cdn.example.com/comps/h05/index.html";
    const { iframe } = makeRawAnimeIframe(src);
    const fetchMock = stubFetchResolved({
      ok: true,
      body: "<html><head><title>x</title></head><body>hi</body></html>",
    });

    const probe = new CompositionProbe(iframe, NOOP_CALLBACKS);
    await startAndTick(probe);

    expect(fetchMock).toHaveBeenCalledWith(src);
    expect(iframe.srcdoc).toContain(`<script src="${DEFAULT_RUNTIME_URL}"></script>`);
    expect(iframe.srcdoc).toContain('<base href="https://cdn.example.com/comps/h05/">');

    probe.stop();
    iframe.remove();
  });

  it("uses the runtime-src override (getRuntimeUrl) instead of the CDN default", async () => {
    const src = "https://cdn.example.com/comps/h05/index.html";
    const { iframe } = makeRawAnimeIframe(src);
    stubFetchResolved({ ok: true, body: "<html><head></head><body></body></html>" });

    const probe = new CompositionProbe(iframe, {
      ...NOOP_CALLBACKS,
      getRuntimeUrl: () => "https://local.test/hyperframe.runtime.iife.js",
    });
    await startAndTick(probe);

    expect(iframe.srcdoc).toContain(
      '<script src="https://local.test/hyperframe.runtime.iife.js"></script>',
    );
    expect(iframe.srcdoc).not.toContain(DEFAULT_RUNTIME_URL);

    probe.stop();
    iframe.remove();
  });

  it("attempts injection exactly once per src (loop guard) even across a restart", async () => {
    const src = "https://cdn.example.com/comps/h05/index.html";
    const { iframe } = makeRawAnimeIframe(src);
    const fetchMock = stubFetchResolved({
      ok: true,
      body: "<html><head></head><body></body></html>",
    });

    const probe = new CompositionProbe(iframe, NOOP_CALLBACKS);
    await startAndTick(probe);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Simulate the srcdoc-triggered reload firing the iframe's "load" handler
    // again (composition-probe.ts never resets the loop guard on start()).
    await startAndTick(probe);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    probe.stop();
    iframe.remove();
  });

  it.each([
    [
      "the runtime bridge is already present",
      () => {
        const { iframe, win } = makeRawAnimeIframe("https://cdn.example.com/comps/h05/index.html");
        Reflect.set(win, "__player", { getDuration: () => 12 });
        return iframe;
      },
    ],
    [
      "the composition never references hyperframesAnime (plain GSAP)",
      () => makeRawGsapIframe("https://cdn.example.com/comps/gsap/index.html").iframe,
    ],
  ])("does not inject when %s", async (_label, makeIframe) => {
    const iframe = makeIframe();
    const fetchMock = stubFetchNeverCalled();

    const probe = new CompositionProbe(iframe, NOOP_CALLBACKS);
    await startAndTick(probe);

    expect(fetchMock).not.toHaveBeenCalled();

    probe.stop();
    iframe.remove();
  });

  it("falls back silently on fetch failure, leaving srcdoc untouched", async () => {
    const src = "https://cdn.example.com/comps/h05/index.html";
    const { iframe } = makeRawAnimeIframe(src);
    stubFetchResolved({ ok: false, status: 404, body: "" });

    const probe = new CompositionProbe(iframe, NOOP_CALLBACKS);
    await startAndTick(probe);

    expect(iframe.srcdoc).toBe("");

    probe.stop();
    iframe.remove();
  });
});

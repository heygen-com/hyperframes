import { describe, expect, it, vi } from "vitest";
import { CompositionProbe, readCompositionSizeFromDocument } from "./composition-probe.js";

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

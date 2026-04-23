import { afterEach, describe, expect, it, vi } from "vitest";
import { selectMediaObserverTargets } from "./mediaObserverScope.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function makeDoc(html: string): Document {
  // happy-dom doesn't ship a usable XMLHttpRequest path for parser-driven
  // doc creation, so we build a fresh document by hand and inject markup
  // through the body — same DOM shape the iframe document will have when
  // the runtime finishes mounting compositions.
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = html;
  return doc;
}

describe("selectMediaObserverTargets", () => {
  it("returns the single root composition host", () => {
    const doc = makeDoc(`
      <div data-composition-id="root"></div>
    `);

    const targets = selectMediaObserverTargets(doc);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.getAttribute("data-composition-id")).toBe("root");
  });

  it("returns only top-level hosts when sub-composition hosts are nested", () => {
    // Mirrors the runtime structure: root host with a sub-composition host
    // mounted inside it. The nested host is already covered by the root
    // host's subtree observation.
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div data-composition-id="sub-1"></div>
        <div>
          <div data-composition-id="sub-2"></div>
        </div>
      </div>
    `);

    const targets = selectMediaObserverTargets(doc);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.getAttribute("data-composition-id")).toBe("root");
  });

  it("returns multiple hosts when they are siblings (no shared ancestor host)", () => {
    const doc = makeDoc(`
      <div data-composition-id="comp-a"></div>
      <div data-composition-id="comp-b"></div>
    `);

    const targets = selectMediaObserverTargets(doc);

    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.getAttribute("data-composition-id"))).toEqual(["comp-a", "comp-b"]);
  });

  it("ignores attribute presence on intermediate non-host elements", () => {
    // Only `data-composition-id` is meaningful; an unrelated `data-composition`
    // attribute on a wrapper must not promote a nested host to top-level.
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div data-composition="not-a-host">
          <div data-composition-id="sub"></div>
        </div>
      </div>
    `);

    const targets = selectMediaObserverTargets(doc);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.getAttribute("data-composition-id")).toBe("root");
  });

  it("falls back to the document body when no composition hosts exist", () => {
    // Documents that haven't been bootstrapped (or never will be) keep the
    // legacy behavior so adoption logic still runs against late additions.
    const doc = makeDoc(`<div class="not-a-composition"></div>`);

    const targets = selectMediaObserverTargets(doc);

    expect(targets).toEqual([doc.body]);
  });

  it("returns an empty array when neither hosts nor body are available", () => {
    // Synthetic edge case — guards the caller against attaching an observer
    // to `undefined` if the document is missing both signals. happy-dom
    // auto-fills `<body>`, so we hand-roll a minimal Document shape rather
    // than fight the runtime.
    const doc = {
      body: null,
      querySelectorAll: () => [],
    } as unknown as Document;

    const targets = selectMediaObserverTargets(doc);

    expect(targets).toEqual([]);
  });

  describe("body-fallback collision warning", () => {
    it("warns when scoped observation skips body-level timed media", () => {
      // Composition host present → scoped path. The body-level <audio data-start>
      // is outside every host subtree, so the observer would never see it.
      // This is precisely the silent-miss the warning is designed to surface.
      const doc = makeDoc(`
        <audio data-start="0" src="theme.mp3"></audio>
        <div data-composition-id="root">
          <video data-start="1" src="hero.mp4"></video>
        </div>
      `);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      selectMediaObserverTargets(doc);

      expect(warn).toHaveBeenCalledTimes(1);
      const [message, orphans] = warn.mock.calls[0] ?? [];
      expect(typeof message).toBe("string");
      expect(message).toContain("body-level timed media");
      expect(Array.isArray(orphans)).toBe(true);
      expect((orphans as Element[]).map((el) => el.tagName)).toEqual(["AUDIO"]);
    });

    it("does not warn when every body-level timed media element lives inside a host", () => {
      // Same body-level audio as above, but now nested under a composition
      // host — the scoped observer will pick it up via the host subtree, so
      // there's no silent-miss to flag.
      const doc = makeDoc(`
        <div data-composition-id="root">
          <audio data-start="0" src="theme.mp3"></audio>
          <video data-start="1" src="hero.mp4"></video>
        </div>
      `);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      selectMediaObserverTargets(doc);

      expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn on the body-fallback path even with orphan timed media", () => {
      // No composition hosts → fallback observer attaches to `doc.body`, which
      // already covers any body-level media. Emitting the warning here would
      // be noise on every legacy / pre-bootstrap document.
      const doc = makeDoc(`
        <audio data-start="0" src="theme.mp3"></audio>
      `);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      selectMediaObserverTargets(doc);

      expect(warn).not.toHaveBeenCalled();
    });

    it("ignores body-level audio/video that are not timed (no data-start)", () => {
      // Untimed media isn't part of the time-sync pipeline, so it doesn't
      // matter whether the observer sees it. Only `[data-start]` orphans
      // qualify as a silent miss worth surfacing.
      const doc = makeDoc(`
        <audio src="ambient.mp3"></audio>
        <div data-composition-id="root"></div>
      `);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      selectMediaObserverTargets(doc);

      expect(warn).not.toHaveBeenCalled();
    });

    it("emits a single warn for multiple orphaned timed media elements", () => {
      // The whole point of the forensic guard is to give a single, batched
      // signal. Spamming one warn per orphan would drown out the diagnostic
      // value on documents with many late-bound clips.
      const doc = makeDoc(`
        <audio data-start="0" src="a.mp3"></audio>
        <video data-start="1" src="b.mp4"></video>
        <audio data-start="2" src="c.mp3"></audio>
        <div data-composition-id="root"></div>
      `);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      selectMediaObserverTargets(doc);

      expect(warn).toHaveBeenCalledTimes(1);
      const [, orphans] = warn.mock.calls[0] ?? [];
      expect((orphans as Element[]).map((el) => el.tagName)).toEqual(["AUDIO", "VIDEO", "AUDIO"]);
    });
  });
});

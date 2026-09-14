import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyWebAudioMediaRoute,
  isRouteSelectionSettled,
  nativeUnexpressibleProcessing,
  reportWebAudioMediaRoute,
} from "./webAudioRoute";

const SAME_ORIGIN = window.location.origin;
const CROSS_ORIGIN = "https://cdn.example.com";

function audio(attrs: Record<string, string> = {}): HTMLAudioElement {
  const el = document.createElement("audio");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

/** jsdom never runs the resource selection algorithm, so `currentSrc` has to be
 *  planted to exercise the branch where the browser has already committed. */
function withCurrentSrc(el: HTMLAudioElement, currentSrc: string): HTMLAudioElement {
  Object.defineProperty(el, "currentSrc", { value: currentSrc, configurable: true });
  return el;
}

/**
 * Shadows the IDL `crossOrigin` accessor with a plain data property, so the
 * value is visible ONLY via the property — unlike `el.crossOrigin = value`
 * (which jsdom, like real browsers, reflects straight back to the
 * `crossorigin` attribute), this simulates a host whose IDL property is
 * genuinely decoupled from the attribute, per `hasCorsOptIn`'s secondary read.
 */
function withUnreflectedCrossOrigin(el: HTMLAudioElement, value: string): HTMLAudioElement {
  Object.defineProperty(el, "crossOrigin", { value, configurable: true });
  return el;
}

/** Stubs the document's actual security origin (`window.origin`) for the
 *  duration of `run`, then restores it — distinct from `location.origin`,
 *  which stays URL-shaped even inside an opaque sandboxed document. */
function withSelfOrigin<T>(origin: string, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(window, "origin");
  Object.defineProperty(window, "origin", { value: origin, configurable: true });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(window, "origin", original);
    else delete (window as { origin?: string }).origin;
  }
}

/** The one console line `reportWebAudioMediaRoute` emits for `el`, or "". */
function bypassLine(el: HTMLAudioElement): string {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));
  return (info.mock.calls[0]?.[0] as string) ?? "";
}

describe("classifyWebAudioMediaRoute", () => {
  it("routes same-origin media through Web Audio", () => {
    expect(classifyWebAudioMediaRoute(audio({ src: "/assets/vo.mp3" }))).toEqual({
      kind: "web-audio",
    });
    expect(classifyWebAudioMediaRoute(audio({ src: `${SAME_ORIGIN}/assets/vo.mp3` }))).toEqual({
      kind: "web-audio",
    });
  });

  it("withholds capture from cross-origin media with no CORS opt-in", () => {
    // The bug: createMediaElementSource here builds a node that outputs silence
    // per spec, without throwing, and permanently steals the element's native
    // output on the way.
    const route = classifyWebAudioMediaRoute(audio({ src: `${CROSS_ORIGIN}/track.mp3` }));

    expect(route).toEqual({
      kind: "decode-only",
      reason: "cross_origin_no_cors",
      asset: `${CROSS_ORIGIN}/track.mp3`,
    });
  });

  it("treats any crossorigin attribute as the opt-in, whatever its value", () => {
    // Enumerated attribute: the invalid-value default is `anonymous`, so every
    // one of these makes the fetch a CORS request. Matching on "anonymous"
    // would strip Web Audio from two of the three.
    for (const value of ["anonymous", "use-credentials", "", "garbage"]) {
      const el = audio({ src: `${CROSS_ORIGIN}/track.mp3`, crossorigin: value });
      expect(classifyWebAudioMediaRoute(el)).toEqual({ kind: "web-audio" });
    }
  });

  it("keeps non-http(s) schemes on the pre-existing path", () => {
    // blob:/data: are same-origin by construction and file: has an opaque
    // origin no comparison can settle — guessing there would cost Web Audio on
    // compositions that never had this problem.
    for (const src of ["blob:https://cdn.example.com/abc", "data:audio/mp3;base64,AAAA"]) {
      expect(classifyWebAudioMediaRoute(audio({ src }))).toEqual({ kind: "web-audio" });
    }
  });

  it("judges only currentSrc once the browser has committed to a resource", () => {
    // The element ended up on a same-origin file. A cross-origin <source> the
    // browser passed over must not cost it its graph.
    const el = audio();
    el.innerHTML =
      `<source src="${CROSS_ORIGIN}/track.mp3">` + `<source src="/assets/fallback.mp3">`;
    withCurrentSrc(el, `${SAME_ORIGIN}/assets/fallback.mp3`);

    expect(classifyWebAudioMediaRoute(el)).toEqual({ kind: "web-audio" });
  });

  it("prefers a src attribute over <source> children, as the spec does", () => {
    const el = audio({ src: "/assets/vo.mp3" });
    el.innerHTML = `<source src="${CROSS_ORIGIN}/track.mp3">`;

    expect(classifyWebAudioMediaRoute(el)).toEqual({ kind: "web-audio" });
  });

  it("checks every <source> candidate while selection is still unsettled", () => {
    // No currentSrc and no src attribute: any candidate could still win, so the
    // conservative read is the only safe one — the node is unbuildable-back.
    const el = audio();
    el.innerHTML = `<source src="/assets/first.mp3">` + `<source src="${CROSS_ORIGIN}/second.mp3">`;

    expect(classifyWebAudioMediaRoute(el)).toEqual({
      kind: "decode-only",
      reason: "cross_origin_no_cors",
      asset: `${CROSS_ORIGIN}/second.mp3`,
    });
  });

  it("routes an element with no resolvable source through Web Audio", () => {
    expect(classifyWebAudioMediaRoute(audio())).toEqual({ kind: "web-audio" });
  });

  it("treats an unreflected empty-string crossOrigin IDL property as opt-in", () => {
    // The IDL fallback for `crossorigin=""` / bare `crossorigin` is the empty
    // string. A host whose property setter doesn't reflect to the attribute
    // (unlike jsdom's own accessor, which does) must not have that empty
    // string misread as "no opt-in" — `Boolean("")` is false, which is
    // exactly the fail-open this test guards against.
    const el = withUnreflectedCrossOrigin(audio({ src: `${CROSS_ORIGIN}/track.mp3` }), "");
    expect(el.getAttribute("crossorigin")).toBeNull(); // confirms it's genuinely unreflected

    expect(classifyWebAudioMediaRoute(el)).toEqual({ kind: "web-audio" });
  });

  it("does not treat an untouched crossOrigin IDL property as opt-in", () => {
    // The other direction of the same risk: a host must not default
    // `crossOrigin` to a truthy/string value for elements that never opted
    // in, or the cross-origin check would be permanently disabled.
    const el = audio({ src: `${CROSS_ORIGIN}/track.mp3` });
    expect(el.crossOrigin).toBeNull();

    expect(classifyWebAudioMediaRoute(el)).toEqual({
      kind: "decode-only",
      reason: "cross_origin_no_cors",
      asset: `${CROSS_ORIGIN}/track.mp3`,
    });
  });

  it("withholds capture when the document's security origin is opaque, even though the URL origins match", () => {
    // See withSelfOrigin above for why this differs from location.origin.
    const asset = `${SAME_ORIGIN}/assets/vo.mp3`;
    const route = withSelfOrigin("null", () => classifyWebAudioMediaRoute(audio({ src: asset })));

    expect(route).toEqual({ kind: "decode-only", reason: "opaque_document_origin", asset });
  });

  it("reports opacity, not foreignness, when the document is opaque AND the asset is remote", () => {
    // Both conditions hold. Opacity is the blocking one and the only one the
    // author cannot fix by moving the asset, so it must win the reason.
    const asset = `${CROSS_ORIGIN}/track.mp3`;
    const route = withSelfOrigin("null", () => classifyWebAudioMediaRoute(audio({ src: asset })));

    expect(route).toEqual({ kind: "decode-only", reason: "opaque_document_origin", asset });
  });

  it("still lets a crossorigin opt-in rescue an opaque document", () => {
    const el = audio({ src: `${CROSS_ORIGIN}/track.mp3`, crossorigin: "anonymous" });
    const route = withSelfOrigin("null", () => classifyWebAudioMediaRoute(el));

    expect(route).toEqual({ kind: "web-audio" });
  });

  it("keeps today's same-origin result when window.origin genuinely matches", () => {
    const asset = `${SAME_ORIGIN}/assets/vo.mp3`;
    const route = withSelfOrigin(SAME_ORIGIN, () =>
      classifyWebAudioMediaRoute(audio({ src: asset })),
    );

    expect(route).toEqual({ kind: "web-audio" });
  });
});

describe("isRouteSelectionSettled", () => {
  it("is unsettled for an element with only <source> children", () => {
    const el = audio();
    el.innerHTML = `<source src="/assets/first.mp3">`;
    expect(isRouteSelectionSettled(el)).toBe(false);
  });

  it("is settled once a src attribute is definitive, even before load", () => {
    expect(isRouteSelectionSettled(audio({ src: "/assets/vo.mp3" }))).toBe(true);
  });

  it("is settled once currentSrc has committed", () => {
    const el = withCurrentSrc(audio(), `${SAME_ORIGIN}/assets/vo.mp3`);
    expect(isRouteSelectionSettled(el)).toBe(true);
  });

  it("is unsettled for an element with no source at all", () => {
    expect(isRouteSelectionSettled(audio())).toBe(false);
  });
});

describe("nativeUnexpressibleProcessing", () => {
  it("reports nothing for a bare track", () => {
    expect(nativeUnexpressibleProcessing(audio({ src: "/a.mp3", "data-volume": "0.5" }))).toEqual(
      [],
    );
  });

  it("names every authored intention native output cannot carry", () => {
    const el = audio({
      "data-fx-chain": "[]",
      "data-automation": "{}",
      "data-audio-group": "vo",
      // `el.volume` is spec-pinned to [0,1], so a boost cannot survive a route
      // whose only gain stage is the element itself.
      "data-volume": "2",
    });

    expect(nativeUnexpressibleProcessing(el)).toEqual([
      "fx-chain",
      "automation",
      "audio-group",
      "above-unity-gain",
    ]);
  });
});

describe("reportWebAudioMediaRoute", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a scrapable console line and a bridge diagnostic for a CORS bypass", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const el = audio({ src: `${CROSS_ORIGIN}/track.mp3` });

    reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

    // The CLI's check gate matches this token, not the prose around it.
    expect(info.mock.calls[0]?.[0]).toContain("[hyperframes] runtime_web_audio_bypass");
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "diagnostic", code: "runtime_web_audio_bypass" }),
      "*",
    );
  });

  it("latches to one diagnostic per element", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = audio({ src: `${CROSS_ORIGIN}/track.mp3` });
    const route = classifyWebAudioMediaRoute(el);

    reportWebAudioMediaRoute(el, route);
    reportWebAudioMediaRoute(el, route);

    expect(info).toHaveBeenCalledTimes(1);
  });

  it("says nothing for an eligible element", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = audio({ src: "/assets/vo.mp3" });

    reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

    expect(info).not.toHaveBeenCalled();
  });

  it("names the dropped processing, and offers a proxy, when a same-origin URL could exist", () => {
    const line = bypassLine(audio({ src: `${CROSS_ORIGIN}/track.mp3`, "data-audio-group": "vo" }));

    expect(line).toContain("audio-group");
    expect(line).toContain("proxy or download the asset to a same-origin URL");
  });

  it("tells an opaque document to fix the sandbox, not to move the asset", () => {
    // The whole point of the second reason. Nothing is same-origin with an
    // opaque origin, so the proxy advice names a fix that cannot exist here.
    const el = audio({ src: `${SAME_ORIGIN}/assets/vo.mp3`, "data-audio-group": "vo" });

    const line = withSelfOrigin("null", () => bypassLine(el));

    expect(line).toContain("audio-group");
    expect(line).toContain("allow-same-origin");
    expect(line).toContain("Access-Control-Allow-Origin");
    expect(line).not.toContain("proxy or download");
  });

  it("puts the opaque reason and its note on the bridge message, not just the console", () => {
    const posted: unknown[] = [];
    const post = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation((message: unknown) => void posted.push(message));
    vi.spyOn(console, "info").mockImplementation(() => {});
    const el = audio({ src: `${SAME_ORIGIN}/assets/vo.mp3` });

    withSelfOrigin("null", () => reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el)));

    const details = (posted[0] as { details?: Record<string, unknown> })?.details ?? {};
    expect(details.reason).toBe("opaque_document_origin");
    expect(String(details.note)).toContain("opaque");
    post.mockRestore();
  });

  describe("render mode", () => {
    afterEach(() => {
      delete window.__HF_EXPORT_RENDER_SEEK_CONFIG;
    });

    it("says nothing during a render pass", () => {
      // Render never plays through Web Audio: the producer mixes offline from
      // the source files and applies the FX chain there, so "native playback
      // cannot reproduce: fx-chain" would be an outright false claim — and the
      // engine forwards every console line into producer stdout, so an ungated
      // report lands in every render log.
      window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "frames" };
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
      const el = audio({ src: `${CROSS_ORIGIN}/track.mp3`, "data-fx-chain": "[]" });

      reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

      expect(info).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });

    it("still reports once the same element is seen outside a render pass", () => {
      // The render-mode skip must not consume the element's one-shot latch.
      window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "frames" };
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const el = audio({ src: `${CROSS_ORIGIN}/track.mp3` });
      reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));
      expect(info).not.toHaveBeenCalled();

      delete window.__HF_EXPORT_RENDER_SEEK_CONFIG;
      reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

      expect(info).toHaveBeenCalledTimes(1);
    });

    it("leaves the verdict itself untouched — only the report is gated", () => {
      window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "frames" };

      expect(classifyWebAudioMediaRoute(audio({ src: `${CROSS_ORIGIN}/track.mp3` }))).toEqual({
        kind: "decode-only",
        reason: "cross_origin_no_cors",
        asset: `${CROSS_ORIGIN}/track.mp3`,
      });
    });
  });
});

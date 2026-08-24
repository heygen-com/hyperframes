import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyWebAudioMediaRoute,
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

  it("gives data-native-audio its own verdict, distinct from the CORS one", () => {
    // Not the same as `decode-only`: this one has to skip decode too, or a
    // decode success puts the element right back under a buffer source.
    const el = audio({ src: "/assets/vo.mp3", "data-native-audio": "" });

    expect(classifyWebAudioMediaRoute(el)).toEqual({
      kind: "native",
      reason: "authored_opt_out",
      asset: "/assets/vo.mp3",
    });
  });

  it("lets data-native-audio win over an otherwise eligible cross-origin read", () => {
    const el = audio({ src: `${CROSS_ORIGIN}/track.mp3`, "data-native-audio": "" });
    expect(classifyWebAudioMediaRoute(el).kind).toBe("native");
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

  it("stays quiet for a bare data-native-audio opt-out", () => {
    // The author asked for native output and nothing is being lost by giving
    // it to them — honouring a request is not a finding.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = audio({ src: "/assets/vo.mp3", "data-native-audio": "" });

    reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

    expect(info).not.toHaveBeenCalled();
  });

  it("still reports a data-native-audio opt-out that drops processing", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = audio({ src: "/a.mp3", "data-native-audio": "", "data-fx-chain": "[]" });

    reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

    expect(info.mock.calls[0]?.[0]).toContain("fx-chain");
  });

  it("names the dropped processing in the CORS bypass line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = audio({ src: `${CROSS_ORIGIN}/track.mp3`, "data-audio-group": "vo" });

    reportWebAudioMediaRoute(el, classifyWebAudioMediaRoute(el));

    expect(info.mock.calls[0]?.[0]).toContain("audio-group");
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

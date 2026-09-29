import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  isAudioElement,
  isElementNode,
  isHtmlElement,
  isImageElement,
  isLinkElement,
  isMediaElement,
  isStylableElement,
  isStyleElement,
  isVideoElement,
} from "./domRealm";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

/**
 * A second realm whose elements are ADOPTED into this realm's document. That is
 * what the Studio preview does on some loads: the composition body is built in
 * the editor window and moved into the preview iframe's document, so the nodes
 * sit in `document` with another realm's prototypes. Every `instanceof
 * HTMLElement` in the runtime then answers false and the guard it protects skips
 * the entire composition, silently.
 */
function foreignRealm() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  return {
    create: <K extends keyof HTMLElementTagNameMap>(tag: K) =>
      dom.window.document.createElement(tag) as unknown as HTMLElementTagNameMap[K],
    createSvg: (tag: string) =>
      dom.window.document.createElementNS(
        "http://www.w3.org/2000/svg",
        tag,
      ) as unknown as SVGElement,
    close: () => dom.window.close(),
  };
}

/** A composition root built in the other realm and adopted into this document. */
function mountCrossRealmRoot(other: ReturnType<typeof foreignRealm>): HTMLElement {
  const root = other.create("div");
  root.setAttribute("data-composition-id", "main");
  root.setAttribute("data-root", "true");
  root.setAttribute("data-start", "0");
  root.setAttribute("data-width", "1920");
  root.setAttribute("data-height", "1080");
  document.body.appendChild(root);
  return root;
}

function mockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true };
  return {
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time?: number) => {
      if (time !== undefined) state.time = time;
      return state.time;
    },
    totalTime: (time?: number) => {
      if (time !== undefined) state.time = time;
      return state.time;
    },
    time: () => state.time,
    duration: () => duration,
    add: () => {},
    paused: (value?: boolean) => {
      if (typeof value === "boolean") state.paused = value;
      return state.paused;
    },
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

describe("domRealm predicates", () => {
  it("matches instanceof for same-realm nodes", () => {
    const div = document.createElement("div");
    const video = document.createElement("video");
    const audio = document.createElement("audio");
    const img = document.createElement("img");
    const style = document.createElement("style");
    const link = document.createElement("link");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "rect");

    expect([
      isHtmlElement(div),
      isVideoElement(video),
      isAudioElement(audio),
      isMediaElement(video),
      isMediaElement(audio),
      isImageElement(img),
      isStyleElement(style),
      isLinkElement(link),
      isElementNode(svg),
    ]).toEqual([true, true, true, true, true, true, true, true, true]);

    // Parity with instanceof HTMLElement, which excludes SVG.
    expect(svg instanceof HTMLElement).toBe(false);
    expect(isHtmlElement(svg)).toBe(false);
    // Position edits apply to SVG too, so the stylable test includes it.
    expect(isStylableElement(svg)).toBe(true);
  });

  it("rejects non-elements without throwing", () => {
    expect([
      isHtmlElement(null),
      isHtmlElement(undefined),
      isHtmlElement("div"),
      isHtmlElement(document),
      isHtmlElement(document.createTextNode("x")),
      isVideoElement({ localName: "video" }),
    ]).toEqual([false, false, false, false, false, false]);
  });

  it("accepts an element adopted from another realm, where instanceof does not", () => {
    const other = foreignRealm();
    try {
      const div = other.create("div");
      const video = other.create("video");
      const audio = other.create("audio");
      const img = other.create("img");
      document.body.append(div, video, audio, img);

      expect(div instanceof HTMLElement).toBe(false);
      expect(video instanceof HTMLVideoElement).toBe(false);
      expect(audio instanceof HTMLAudioElement).toBe(false);
      expect(img instanceof HTMLImageElement).toBe(false);

      expect(isHtmlElement(div)).toBe(true);
      expect(isVideoElement(video)).toBe(true);
      expect(isMediaElement(video)).toBe(true);
      expect(isAudioElement(audio)).toBe(true);
      expect(isImageElement(img)).toBe(true);

      // `isMediaElement` is the audio-or-video composition, and the media sync
      // path narrows through it, so an audio-only regression must fail here too.
      expect(isMediaElement(audio)).toBe(true);
      expect(isVideoElement(audio)).toBe(false);
      expect(isAudioElement(video)).toBe(false);

      // Position edits apply to SVG as well as HTML, so that branch needs the
      // same cross-realm guarantee.
      const rect = other.createSvg("rect");
      document.body.append(rect);
      expect(rect instanceof SVGElement).toBe(false);
      expect(isStylableElement(rect)).toBe(true);
      expect(isHtmlElement(rect)).toBe(false);
    } finally {
      other.close();
    }
  });
});

describe("runtime passes over a composition adopted from another realm", () => {
  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__renderReady;
  });

  /**
   * Every timed element must end up with an explicit inline `visibility`, and
   * it must track the playhead. Leave any of them unwritten and the browser
   * paints every scene on top of every other for the life of the page.
   */
  it("writes timed-element visibility for cross-realm clips", () => {
    const other = foreignRealm();
    try {
      const root = mountCrossRealmRoot(other);

      const early = other.create("div");
      early.setAttribute("data-start", "0");
      early.setAttribute("data-duration", "2");
      root.appendChild(early);

      const late = other.create("div");
      late.setAttribute("data-start", "4");
      late.setAttribute("data-duration", "2");
      root.appendChild(late);

      window.__timelines = { main: mockTimeline(10) };
      initSandboxRuntimeModular();
      window.__player?.renderSeek(1);

      expect([early.style.visibility, late.style.visibility]).toEqual(["visible", "hidden"]);

      window.__player?.renderSeek(4.5);
      expect([early.style.visibility, late.style.visibility]).toEqual(["hidden", "visible"]);
    } finally {
      other.close();
    }
  });

  /**
   * An ID'd child of the composition root must still be auto-stamped, so the
   * Studio timeline can show it as a clip and the design panel can select it.
   */
  it("auto-stamps ID'd children of a cross-realm composition root", () => {
    const other = foreignRealm();
    try {
      const root = mountCrossRealmRoot(other);

      const chip = other.create("div");
      chip.id = "kicker-chip";
      root.appendChild(chip);

      window.__timelines = { main: mockTimeline(10) };
      // The stamp only runs inside the studio preview (`window.parent !== window`).
      const realParent = window.parent;
      Object.defineProperty(window, "parent", { value: {}, configurable: true });
      try {
        initSandboxRuntimeModular();
      } finally {
        Object.defineProperty(window, "parent", { value: realParent, configurable: true });
      }

      expect(chip.getAttribute("data-start")).toBe("0");
      expect(chip.getAttribute("data-hf-autostamped")).toBe("1");
      expect(document.querySelectorAll("[data-start]")).toHaveLength(2);
    } finally {
      other.close();
    }
  });
});

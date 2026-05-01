import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  buildStandaloneRootTimelineElement,
  createTimelineElementFromManifestClip,
  findTimelineDomNodeForClip,
  getTimelineElementSelector,
  parseTimelineFromDOM,
  type ClipManifestClip,
  mergeTimelineElementsPreservingDowngrades,
  resolveStandaloneRootCompositionSrc,
  shouldIgnorePlaybackShortcutEvent,
  shouldIgnorePlaybackShortcutTarget,
} from "./useTimelinePlayer";

function createDocument(markup: string): Document {
  const window = new Window();
  Object.assign(window, { SyntaxError });
  window.document.body.innerHTML = markup;
  return window.document;
}

function createClip(overrides: Partial<ClipManifestClip>): ClipManifestClip {
  return {
    id: null,
    label: "",
    start: 0,
    duration: 4,
    track: 0,
    kind: "element",
    tagName: "div",
    compositionId: null,
    parentCompositionId: null,
    compositionSrc: null,
    assetUrl: null,
    ...overrides,
  };
}

function mockTargetMatching(selectorNeedle: string): EventTarget {
  return {
    closest: (selector: string) => (selector.includes(selectorNeedle) ? ({} as Element) : null),
  } as unknown as EventTarget;
}

function mockKeyboardEvent(
  code: string,
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "target">> = {},
): Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "code" | "target"> {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    code,
    target: mockTargetMatching("[data-missing]"),
    ...overrides,
  };
}

describe("buildStandaloneRootTimelineElement", () => {
  it("includes selector and source metadata for standalone composition fallback clips", () => {
    expect(
      buildStandaloneRootTimelineElement({
        compositionId: "hero",
        tagName: "DIV",
        rootDuration: 8,
        iframeSrc: "http://127.0.0.1:4173/api/projects/demo/preview/comp/scenes/hero.html?_t=123",
        selector: '[data-composition-id="hero"]',
      }),
    ).toEqual({
      id: "hero",
      label: "hero",
      key: 'scenes/hero.html:[data-composition-id="hero"]:0',
      tag: "div",
      start: 0,
      duration: 8,
      track: 0,
      compositionSrc: "scenes/hero.html",
      selector: '[data-composition-id="hero"]',
      selectorIndex: undefined,
      sourceFile: "scenes/hero.html",
    });
  });

  it("returns null for invalid fallback durations", () => {
    expect(
      buildStandaloneRootTimelineElement({
        compositionId: "hero",
        tagName: "div",
        rootDuration: 0,
        iframeSrc: "http://localhost/preview/comp/hero.html",
      }),
    ).toBe(null);
    expect(
      buildStandaloneRootTimelineElement({
        compositionId: "hero",
        tagName: "div",
        rootDuration: Number.NaN,
        iframeSrc: "http://localhost/preview/comp/hero.html",
      }),
    ).toBe(null);
  });
});

describe("resolveStandaloneRootCompositionSrc", () => {
  it("extracts the composition path from a preview iframe url", () => {
    expect(
      resolveStandaloneRootCompositionSrc(
        "http://127.0.0.1:4173/api/projects/demo/preview/comp/scenes/hero.html?_t=123",
      ),
    ).toBe("scenes/hero.html");
  });

  it("returns undefined for non-composition preview urls", () => {
    expect(
      resolveStandaloneRootCompositionSrc("http://127.0.0.1:4173/api/projects/demo/preview"),
    ).toBe(undefined);
  });
});

describe("findTimelineDomNodeForClip", () => {
  it("matches anonymous manifest clips back to repeated DOM nodes in timeline order", () => {
    const doc = createDocument(`
      <div data-composition-id="main" data-start="0" data-duration="8">
        <section id="identity-card" class="clip identity-card" data-start="0" data-duration="4" data-track-index="0"></section>
        <div class="clip duplicate-card first" data-start="0" data-duration="4" data-track-index="1"></div>
        <div class="clip duplicate-card second" data-start="0" data-duration="4" data-track-index="2"></div>
      </div>
    `);
    const used = new Set<Element>();

    const first = findTimelineDomNodeForClip(
      doc,
      createClip({ id: "__node__index_2", track: 1 }),
      1,
      used,
    ) as HTMLElement;
    used.add(first);
    const second = findTimelineDomNodeForClip(
      doc,
      createClip({ id: "__node__index_3", track: 2 }),
      2,
      used,
    ) as HTMLElement;

    expect(first.className).toBe("clip duplicate-card first");
    expect(second.className).toBe("clip duplicate-card second");
    expect(getTimelineElementSelector(first)).toBe(".duplicate-card");
    expect(getTimelineElementSelector(second)).toBe(".duplicate-card");
  });
});

describe("anonymous timeline identity", () => {
  it("keeps fallback-parsed anonymous clips distinct when labels match", () => {
    const doc = createDocument(`
      <div data-composition-id="main" data-start="0" data-duration="8">
        <div class="clip card" data-label="Card" data-start="0" data-duration="3" data-track-index="0"></div>
        <div class="clip card" data-label="Card" data-start="3" data-duration="3" data-track-index="1"></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 8);

    expect(elements).toHaveLength(2);
    expect(elements.map((element) => element.label)).toEqual(["Card", "Card"]);
    expect(new Set(elements.map((element) => element.id)).size).toBe(2);
    expect(new Set(elements.map((element) => element.key)).size).toBe(2);
    expect(elements.map((element) => element.selectorIndex)).toEqual([0, 1]);
  });

  it("keeps runtime-manifest anonymous clips distinct when labels match", () => {
    const doc = createDocument(`
      <div data-composition-id="main" data-start="0" data-duration="8">
        <div class="clip card" data-start="0" data-duration="3" data-track-index="0"></div>
        <div class="clip card" data-start="3" data-duration="3" data-track-index="1"></div>
      </div>
    `);
    const clips = [
      createClip({ id: null, label: "Card", start: 0, duration: 3, track: 0 }),
      createClip({ id: null, label: "Card", start: 3, duration: 3, track: 1 }),
    ];
    const used = new Set<Element>();
    const elements = clips.map((clip, index) => {
      const hostEl = findTimelineDomNodeForClip(doc, clip, index, used);
      if (hostEl) used.add(hostEl);
      return createTimelineElementFromManifestClip({
        clip,
        fallbackIndex: index,
        doc,
        hostEl,
      });
    });

    expect(elements.map((element) => element.label)).toEqual(["Card", "Card"]);
    expect(new Set(elements.map((element) => element.id)).size).toBe(2);
    expect(new Set(elements.map((element) => element.key)).size).toBe(2);
    expect(elements.map((element) => element.selectorIndex)).toEqual([0, 1]);
  });

  it("reads media metadata from owner-window media elements", () => {
    const doc = createDocument(`
      <div data-composition-id="main" data-start="0" data-duration="8">
        <div class="clip video-card" data-start="0" data-duration="3" data-track-index="0">
          <video src="/clip.mp4" data-source-duration="12"></video>
        </div>
      </div>
    `);
    const hostEl = doc.querySelector(".video-card");
    const video = hostEl?.querySelector("video");
    if (!hostEl || !video) throw new Error("missing video test fixture");
    Object.defineProperty(video, "defaultPlaybackRate", {
      value: 1.5,
      configurable: true,
    });

    const element = createTimelineElementFromManifestClip({
      clip: createClip({ kind: "video", tagName: "div" }),
      fallbackIndex: 0,
      doc,
      hostEl,
    });

    expect(element.tag).toBe("video");
    expect(element.src).toBe("/clip.mp4");
    expect(element.sourceDuration).toBe(12);
    expect(element.playbackRate).toBe(1.5);
  });
});

describe("mergeTimelineElementsPreservingDowngrades", () => {
  it("preserves missing current elements when a shorter manifest arrives", () => {
    expect(
      mergeTimelineElementsPreservingDowngrades(
        [
          { id: "hero", tag: "div", start: 0, duration: 4, track: 0 },
          { id: "cta", tag: "div", start: 4, duration: 2, track: 1 },
        ],
        [{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
        8,
        8,
      ),
    ).toEqual([
      { id: "hero", tag: "div", start: 0, duration: 4, track: 0 },
      { id: "cta", tag: "div", start: 4, duration: 2, track: 1 },
    ]);
  });

  it("accepts longer-duration or same-size updates as authoritative", () => {
    expect(
      mergeTimelineElementsPreservingDowngrades(
        [{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
        [{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
        4,
        6,
      ),
    ).toEqual([{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }]);
  });

  it("preserves distinct anonymous clips that share the same friendly id label", () => {
    expect(
      mergeTimelineElementsPreservingDowngrades(
        [
          {
            id: "Card",
            key: "index.html:.card:0",
            label: "Card",
            tag: "div",
            start: 0,
            duration: 3,
            track: 0,
          },
          {
            id: "Card",
            key: "index.html:.card:1",
            label: "Card",
            tag: "div",
            start: 3,
            duration: 3,
            track: 1,
          },
        ],
        [
          {
            id: "Card",
            key: "index.html:.card:0",
            label: "Card",
            tag: "div",
            start: 0,
            duration: 3,
            track: 0,
          },
        ],
        8,
        8,
      ),
    ).toEqual([
      {
        id: "Card",
        key: "index.html:.card:0",
        label: "Card",
        tag: "div",
        start: 0,
        duration: 3,
        track: 0,
      },
      {
        id: "Card",
        key: "index.html:.card:1",
        label: "Card",
        tag: "div",
        start: 3,
        duration: 3,
        track: 1,
      },
    ]);
  });
});

describe("shouldIgnorePlaybackShortcutTarget", () => {
  it("ignores focused toolbar buttons so Space can activate the button itself", () => {
    expect(shouldIgnorePlaybackShortcutTarget(mockTargetMatching("button"))).toBe(true);
  });

  it("ignores the seek slider so ArrowRight reaches the slider key handler", () => {
    expect(shouldIgnorePlaybackShortcutTarget(mockTargetMatching("[role='slider']"))).toBe(true);
  });

  it("allows non-interactive preview targets to use playback shortcuts", () => {
    expect(shouldIgnorePlaybackShortcutTarget(mockTargetMatching("[data-missing]"))).toBe(false);
  });
});

describe("shouldIgnorePlaybackShortcutEvent", () => {
  it("ignores modified playback shortcuts so browser and app chords can handle them", () => {
    expect(
      shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("ArrowLeft", { altKey: true })),
    ).toBe(true);
    expect(shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("KeyK", { ctrlKey: true }))).toBe(
      true,
    );
    expect(shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("KeyL", { metaKey: true }))).toBe(
      true,
    );
  });

  it("defers Arrow frame shortcuts while caption edit mode has selected words", () => {
    const captionSelection = { isCaptionEditMode: true, selectedCaptionSegmentCount: 1 };

    expect(
      shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("ArrowLeft"), captionSelection),
    ).toBe(true);
    expect(
      shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("ArrowRight"), captionSelection),
    ).toBe(true);
    expect(shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("KeyJ"), captionSelection)).toBe(
      false,
    );
  });

  it("allows Arrow frame shortcuts when captions are not selected", () => {
    expect(
      shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("ArrowRight"), {
        isCaptionEditMode: true,
        selectedCaptionSegmentCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldIgnorePlaybackShortcutEvent(mockKeyboardEvent("ArrowRight"), {
        isCaptionEditMode: false,
        selectedCaptionSegmentCount: 1,
      }),
    ).toBe(false);
  });
});

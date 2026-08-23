// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createTimelineElementFromManifestClip,
  parseTimelineFromDOM,
  createImplicitTimelineLayersFromDOM,
  mergeTimelineElementsPreservingDowngrades,
} from "./timelineDOM";
import { isTimelineIgnoredElement } from "./timelineElementHelpers";
import { invalidateGroupInfoCache } from "./timelineGroupInfo";
import type { TimelineElement } from "../store/playerStore";

function el(id: string, extra: Partial<TimelineElement> = {}): TimelineElement {
  return { id, tag: "img", start: 0, duration: 5, track: 0, ...extra };
}

function makeDoc(html: string): Document {
  const d = document.implementation.createHTMLDocument();
  d.body.innerHTML = html;
  return d;
}

describe("parseTimelineFromDOM — hfId from data-hf-id", () => {
  it("harvests hfId from a data-start element that has data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" data-hf-id="hf-abc123"></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);
    const hero = elements.find((el) => el.domId === "hero");

    expect(hero).toBeDefined();
    expect(hero?.hfId).toBe("hf-abc123");
  });

  it("leaves hfId undefined when element has no data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="plain" class="clip" data-start="0" data-duration="5"></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);
    const plain = elements.find((el) => el.domId === "plain");

    expect(plain).toBeDefined();
    expect(plain?.hfId).toBeUndefined();
  });

  it("ignores runtime-owned color grading canvases with timing attributes", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <img id="photo" class="clip" data-start="0" data-duration="5" />
        <canvas
          class="__hf_color_grading_canvas__"
          data-hf-color-grading-canvas="true"
          data-hyperframes-ignore
          data-start="0"
          data-duration="5"
        ></canvas>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);

    expect(elements.map((el) => el.tag)).toEqual(["img"]);
  });

  it("marks parsed timeline elements hidden when data-hidden is present", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" data-hidden></div>
      </div>
    `);

    const elements = parseTimelineFromDOM(doc, 10);
    const hero = elements.find((el) => el.domId === "hero");

    expect(hero?.hidden).toBe(true);
  });

  it("marks manifest timeline elements hidden when the host has data-hidden", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="hero" class="clip" data-start="0" data-duration="5" data-hidden></div>
      </div>
    `);
    const hostEl = doc.getElementById("hero");

    const element = createTimelineElementFromManifestClip({
      clip: {
        id: "hero",
        label: "Hero",
        kind: "element",
        tagName: "div",
        start: 0,
        duration: 5,
        track: 0,
        compositionId: null,
        parentCompositionId: null,
        compositionSrc: null,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl,
    });

    expect(element.hidden).toBe(true);
  });
});

describe("group info cache", () => {
  const parseMember = (doc: Document) =>
    createTimelineElementFromManifestClip({
      clip: {
        id: "voice-1",
        label: "voice-1",
        kind: "element",
        tagName: "audio",
        start: 0,
        duration: 5,
        track: 0,
        compositionId: null,
        parentCompositionId: null,
        compositionSrc: null,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl: doc.getElementById("voice-1"),
    });

  // Group edits are applied as LIVE patches so the preview iframe never
  // reloads, which means the document identity this cache is keyed on never
  // changes either. Without an explicit drop, a muted group could never be
  // unmuted: the header kept reading the cached `hidden: false` and re-wrote
  // `data-hidden` forever.
  it("re-reads group state after an invalidation", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <audio id="voice-1" data-start="0" data-duration="5" data-audio-group="voiceover"></audio>
        <hf-audio-group id="voiceover" data-label="Voices"></hf-audio-group>
      </div>
    `);

    expect(parseMember(doc).audioGroupHidden).toBe(false);

    doc.getElementById("voiceover")?.setAttribute("data-hidden", "");
    expect(parseMember(doc).audioGroupHidden).toBe(false); // still the cached scan

    invalidateGroupInfoCache(doc);
    expect(parseMember(doc).audioGroupHidden).toBe(true);

    doc.getElementById("voiceover")?.removeAttribute("data-hidden");
    invalidateGroupInfoCache(doc);
    expect(parseMember(doc).audioGroupHidden).toBe(false);
  });

  // The explicit invalidator is a convenience, not the contract. A cache whose
  // only defence is "every writer must remember to call this" rots the first
  // time a writer does not know it exists — which is precisely what happened
  // with the FX rack, whose group writes go through the DOM editor rather than
  // the timeline's own writers. The scan carries the DOM revision it was taken
  // at, so a forgotten call costs a re-scan rather than a wrong answer.
  it("expires itself on a group edit nobody announced", async () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <audio id="voice-1" data-start="0" data-duration="5" data-audio-group="voiceover"></audio>
        <hf-audio-group id="voiceover" data-label="Voices"></hf-audio-group>
      </div>
    `);

    expect(parseMember(doc).audioGroupHidden).toBe(false);

    // No invalidateGroupInfoCache call anywhere in this test.
    doc.getElementById("voiceover")?.setAttribute("data-hidden", "");
    await new Promise((resolve) => setTimeout(resolve, 0)); // observer microtask

    expect(parseMember(doc).audioGroupHidden).toBe(true);
  });

  it("notices a member joining the group, not just an attribute edit", async () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <audio id="voice-1" data-start="0" data-duration="5" data-audio-group="voiceover"></audio>
        <hf-audio-group id="voiceover" data-label="Voices"></hf-audio-group>
      </div>
    `);
    expect(parseMember(doc).audioGroupLabel).toBe("Voices");

    doc.getElementById("voiceover")?.setAttribute("data-label", "Narration");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(parseMember(doc).audioGroupLabel).toBe("Narration");
  });
});

describe("parseTimelineFromDOM — canonical playback rate", () => {
  it.each([
    ["10", 5],
    ["0.01", 0.1],
  ])("clamps authored rate %s to %s for trim and split math", (authored, expected) => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="nested" class="clip" data-composition-src="scene.html"
          data-start="0" data-duration="5" data-playback-rate="${authored}"></div>
      </div>
    `);

    const nested = parseTimelineFromDOM(doc, 10).find((entry) => entry.domId === "nested");

    expect(nested?.playbackRate).toBe(expected);
  });
});

describe("createTimelineElementFromManifestClip — source-scoped selector identity", () => {
  it("preserves composition kind and source timing on first translation", () => {
    const doc = makeDoc(`
      <div data-composition-id="root" data-composition-file="index.html">
        <div id="host" data-composition-id="scene" data-composition-src="scene.html"
          data-playback-start="1.5" data-playback-rate="2"></div>
      </div>
    `);
    const host = doc.getElementById("host");

    const element = createTimelineElementFromManifestClip({
      clip: {
        id: "host",
        label: "Scene",
        kind: "composition",
        tagName: "div",
        start: 2,
        duration: 4,
        track: 0,
        compositionId: "scene",
        parentCompositionId: "root",
        compositionSrc: "scene.html",
        playbackStart: 1.5,
        playbackRate: 2,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl: host,
    });

    expect(element).toMatchObject({
      kind: "composition",
      compositionSrc: "scene.html",
      playbackStart: 1.5,
      playbackStartAttr: "playback-start",
      playbackRate: 2,
      domId: "host",
    });
  });

  it("ignores an index.html duplicate when indexing a scene.html selector", () => {
    const doc = makeDoc(`
      <div data-composition-id="root" data-composition-file="index.html">
        <div class="sub"></div>
        <div data-composition-id="scene" data-composition-file="scene.html">
          <div class="sub"></div>
          <div class="sub" data-target></div>
        </div>
      </div>
    `);
    const target = doc.querySelector("[data-target]");
    if (!target) throw new Error("missing target");

    const element = createTimelineElementFromManifestClip({
      clip: {
        id: null,
        label: "Sub",
        kind: "element",
        tagName: "div",
        start: 0,
        duration: 5,
        track: 0,
        compositionId: null,
        parentCompositionId: null,
        compositionSrc: null,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl: target,
    });

    expect(element.sourceFile).toBe("scene.html");
    expect(element.selectorIndex).toBe(1);
    expect(element.key).toBe("scene.html:.sub:1");
  });
});

// Caught by looking at the studio, not by reading: a grouped composition drew
// "Voiceover • 0.0s – 12.0s" as a full-duration clip row directly above its own
// group header. `<hf-audio-group>` is a mixer bus — no timing, drawn as a group
// row by the group derivation — but it is still a body child with an id, so the
// implicit-layer fallback happily gave it a track. Draggable and trimmable, and
// writing timing onto a bus means nothing.
describe("<hf-audio-group> is not a timeline layer", () => {
  it("gets no implicit row of its own", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <audio id="voice-1" data-start="0" data-duration="6" data-audio-group="voiceover"></audio>
        <hf-audio-group id="voiceover" data-label="Voiceover"></hf-audio-group>
      </div>
    `);

    const implicit = createImplicitTimelineLayersFromDOM(doc, 12, []);

    expect(implicit.map((el) => el.domId)).not.toContain("voiceover");
  });

  it("is excluded by the shared ignore predicate", () => {
    const doc = makeDoc(`<hf-audio-group id="vo"></hf-audio-group><div id="panel"></div>`);
    expect(isTimelineIgnoredElement(doc.getElementById("vo") as Element)).toBe(true);
    expect(isTimelineIgnoredElement(doc.getElementById("panel") as Element)).toBe(false);
  });
});

describe("createImplicitTimelineLayersFromDOM — hfId from data-hf-id", () => {
  it("uses the runtime root paint scope for implicit siblings of manifest clips", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="timed" data-start="0" data-duration="5"></div>
        <div id="implicit"></div>
      </div>
    `);
    const timedHost = doc.getElementById("timed");
    const timed = createTimelineElementFromManifestClip({
      clip: {
        id: "timed",
        label: "Timed",
        start: 0,
        duration: 5,
        track: 0,
        stackingContextId: "css:root",
        kind: "element",
        tagName: "div",
        compositionId: null,
        parentCompositionId: null,
        compositionSrc: null,
        assetUrl: null,
      },
      fallbackIndex: 0,
      doc,
      hostEl: timedHost,
    });
    const implicit = createImplicitTimelineLayersFromDOM(doc, 5, [timed])[0];

    expect(implicit?.stackingContextId).toBe("css:root");
    expect(implicit?.stackingContextId).toBe(timed.stackingContextId);
  });

  it("harvests hfId from an implicit layer child that has data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div id="layer" class="clip" data-hf-id="hf-xyz789"></div>
      </div>
    `);

    const layers = createImplicitTimelineLayersFromDOM(doc, 10);
    const layer = layers.find((el) => el.domId === "layer");

    expect(layer).toBeDefined();
    expect(layer?.hfId).toBe("hf-xyz789");
  });

  it("ignores runtime-owned color grading canvases as implicit layers", () => {
    const doc = makeDoc(`
      <div data-composition-id="root" data-duration="5">
        <img id="photo" class="clip" data-start="0" data-duration="5" />
        <canvas
          class="__hf_color_grading_canvas__"
          data-hf-color-grading-canvas="true"
          data-hyperframes-ignore
        ></canvas>
      </div>
    `);

    const layers = createImplicitTimelineLayersFromDOM(doc, 5);

    expect(layers).toEqual([]);
  });
});

describe("mergeTimelineElementsPreservingDowngrades — genuine removal vs transient downgrade", () => {
  it("drops a removed TOP-LEVEL element (undo of a split) instead of ghosting it", () => {
    const current = [el("a"), el("a-split")]; // post-split store: original + clone
    const next = [el("a")]; // fresh scan of the reverted file: clone gone
    const merged = mergeTimelineElementsPreservingDowngrades(current, next, 30, 30);
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });

  it("still preserves an enriched sub-composition child a bare re-scan drops", () => {
    const current = [el("a"), el("sub-child", { compositionSrc: "sub.html" })];
    const next = [el("a")]; // bare DOM scan misses the enriched sub-comp child
    const merged = mergeTimelineElementsPreservingDowngrades(current, next, 30, 30);
    expect(merged.map((e) => e.id).sort()).toEqual(["a", "sub-child"]);
  });

  it("trusts the fresh scan fully when it is not shorter", () => {
    const current = [el("a"), el("b", { compositionSrc: "sub.html" })];
    const next = [el("a"), el("c")];
    expect(
      mergeTimelineElementsPreservingDowngrades(current, next, 30, 30).map((e) => e.id),
    ).toEqual(["a", "c"]);
  });
});

describe("audio FX attributes on parsed elements", () => {
  const CHAIN = '{"version":1,"nodes":[{"type":"lowpass","id":"n1","params":{}}]}';
  const LANE = '{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1}]}]}';

  it("carries data-fx-chain and data-automation off the element", () => {
    // The timeline row is what reserves automation height and draws the lanes;
    // parsed straight from the DOM it used to arrive without either attribute,
    // so the panel showed a chain the timeline could not.
    const doc = new DOMParser().parseFromString(
      `<div data-composition-id="main" data-start="0" data-duration="10">
         <audio id="bgm" data-start="0" data-duration="10" data-fx-chain='${CHAIN}'
           data-automation='${LANE}'></audio>
       </div>`,
      "text/html",
    );
    const [bgm] = parseTimelineFromDOM(doc, 10).filter((e) => e.domId === "bgm");
    expect(bgm?.fxChain).toBe(CHAIN);
    expect(bgm?.automation).toBe(LANE);
  });

  it("leaves them unset on a track that carries neither", () => {
    const doc = new DOMParser().parseFromString(
      `<div data-composition-id="main" data-start="0" data-duration="10">
         <audio id="bgm" data-start="0" data-duration="10"></audio>
       </div>`,
      "text/html",
    );
    const [bgm] = parseTimelineFromDOM(doc, 10).filter((e) => e.domId === "bgm");
    expect(bgm?.fxChain).toBeUndefined();
    expect(bgm?.automation).toBeUndefined();
  });
});

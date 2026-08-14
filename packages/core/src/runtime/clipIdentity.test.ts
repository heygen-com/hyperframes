import { describe, it, expect, afterEach } from "vitest";
import { createClipTree } from "./clipTree";
import { collectRuntimeTimelinePayload } from "./timeline";

/**
 * Characterization of the ONE contract two runtime paths publish under the same
 * name: `clip.id` in `__clipManifest` (timeline.ts) and `node.id` in
 * `__clipTree` (clipTree.ts). Studio joins the two id spaces — the tree builds
 * `clipParentMap`, the manifest supplies the clip that looks a parent up in it
 * (see useTimelineSyncCallbacks.ts) — so any change to either side is a change
 * to element identity, and studio diffs identity to decide "same element" vs
 * "replaced element". A replacement drops selection, expanded rows, the
 * keyframe cache and lint findings.
 *
 * These tests pin what each path emits TODAY. They are a guard for anyone
 * unifying the two fallbacks, not an endorsement of the current split.
 */

const treeParams = {
  startResolver: { resolveStartForElement: () => 0 },
  timelineRegistry: {},
  rootDuration: 10,
};

function treeIds(): string[] {
  const ids: string[] = [];
  const walk = (nodes: readonly { id: string; children: readonly unknown[] }[]): void => {
    for (const node of nodes) {
      ids.push(node.id);
      walk(node.children as readonly { id: string; children: readonly unknown[] }[]);
    }
  };
  walk(createClipTree(treeParams).roots);
  return ids;
}

function manifestIds(): (string | null)[] {
  return collectRuntimeTimelinePayload({ canonicalFps: 30 }).clips.map((clip) => clip.id);
}

describe("clip identity — manifest vs tree", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("agrees on every clip that carries an id of its own", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-duration="10" data-start="0">
        <div id="has-dom-id" data-start="0" data-duration="2"></div>
        <div data-hf-id="hf-only" data-start="0" data-duration="2"></div>
      </div>`;

    expect(treeIds()).toEqual(["has-dom-id", "hf-only"]);
    expect(manifestIds()).toEqual(["has-dom-id", "hf-only"]);
  });

  // The two disagreeing fallbacks. A clip with only a composition id is named
  // by that composition id in the manifest but ordinally in the tree; a clip
  // with no identity at all is `null` in the manifest and ordinal in the tree.
  it("disagrees on clips with no id of their own", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-duration="10" data-start="0">
        <div data-composition-id="sub" data-start="0" data-duration="2"></div>
        <div class="anonymous" data-start="0" data-duration="2"></div>
      </div>`;

    expect(treeIds()).toEqual(["__clip-0", "__clip-1"]);
    expect(manifestIds()).toEqual(["sub", null]);
  });

  /**
   * Why the manifest cannot simply mirror `__clip-${ordinal++}`.
   *
   * The two traversals do not enumerate the same elements, so the Nth id-less
   * clip of one is not the Nth id-less clip of the other:
   *   - clipTree queries `[data-start]`; the manifest also takes
   *     `[data-track-index]`, `[data-composition-id]`, `video`, `audio`, `img`.
   *   - clipTree keeps any element whose window is non-empty against the root
   *     duration; the manifest drops elements whose duration it cannot resolve
   *     from an attribute, a registered timeline, media, or an enclosing
   *     composition.
   *
   * Below, the `<img>` is a manifest clip and not a tree node. A mirrored
   * counter would therefore name it `__clip-0` in the manifest, and name the
   * DIV — which is `__clip-0` in the tree — `__clip-1`. Studio's parent lookup
   * would then resolve a clip against another element's tree node: today's
   * `null` fails closed, a mismatched ordinal fails open.
   */
  it("cannot mirror the tree ordinal: the traversals enumerate different elements", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-duration="10" data-start="0">
        <img data-duration="2" src="a.png" alt="" />
        <div class="anonymous" data-start="0" data-duration="2"></div>
      </div>`;

    // The tree never sees the <img> (no data-start), so the DIV is its first
    // — and only — synthesized ordinal.
    expect(treeIds()).toEqual(["__clip-0"]);

    // The manifest sees both, and the <img> comes first in document order.
    const clips = collectRuntimeTimelinePayload({ canonicalFps: 30 }).clips;
    expect(clips.map((clip) => clip.tagName)).toEqual(["img", "div"]);
    expect(clips.map((clip) => clip.id)).toEqual([null, null]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  audioGroupOf,
  ensureAudioGroupInertStyle,
  HF_AUDIO_GROUP_ATTR,
  resolveAudioGroups,
  resolveCarveSourceIds,
} from "./audioGroups.js";

beforeEach(() => {
  document.body.innerHTML = "";
  // The inert stylesheet is injected once per document, so a leftover from an
  // earlier test would carry the assertion for the one after it.
  document.getElementById("__hf-audio-group-inert")?.remove();
});

describe("resolveAudioGroups", () => {
  it("returns one group of two members plus ignores an ungrouped track", () => {
    document.body.innerHTML = `
      <hf-audio-group id="voiceover" data-label="Voiceover"></hf-audio-group>
      <audio id="vo-1" data-audio-group="voiceover"></audio>
      <audio id="vo-2" data-audio-group="voiceover"></audio>
      <audio id="sfx-1"></audio>
    `;
    const groups = resolveAudioGroups(document);
    expect(groups).toEqual([{ id: "voiceover", label: "Voiceover", memberIds: ["vo-1", "vo-2"] }]);
  });

  it("resolves from member tags alone when the group element is absent, label = id", () => {
    document.body.innerHTML = `
      <audio id="vo-1" data-audio-group="narration"></audio>
    `;
    const groups = resolveAudioGroups(document);
    expect(groups).toEqual([{ id: "narration", label: "narration", memberIds: ["vo-1"] }]);
  });

  it("ignores data-audio-group on the group element itself (groups do not nest)", () => {
    document.body.innerHTML = `
      <hf-audio-group id="outer" data-audio-group="outer"></hf-audio-group>
      <audio id="vo-1" data-audio-group="outer"></audio>
    `;
    const groups = resolveAudioGroups(document);
    expect(groups).toEqual([{ id: "outer", label: "outer", memberIds: ["vo-1"] }]);
    expect(audioGroupOf(document.getElementById("outer") as Element)).toBeNull();
  });

  it("drops a member removed from the DOM on re-resolve — nothing dangles", () => {
    document.body.innerHTML = `
      <audio id="vo-1" data-audio-group="voiceover"></audio>
      <audio id="vo-2" data-audio-group="voiceover"></audio>
    `;
    expect(resolveAudioGroups(document)[0].memberIds).toEqual(["vo-1", "vo-2"]);

    document.getElementById("vo-2")?.remove();
    expect(resolveAudioGroups(document)[0].memberIds).toEqual(["vo-1"]);
  });

  it("ignores a data-audio-group on a video element (audio only in v1)", () => {
    document.body.innerHTML = `<video id="v-1" data-audio-group="voiceover"></video>`;
    expect(resolveAudioGroups(document)).toEqual([]);
  });
});

describe("audioGroupOf", () => {
  it("reads the member's group id", () => {
    document.body.innerHTML = `<audio id="vo-1" data-audio-group="voiceover"></audio>`;
    expect(audioGroupOf(document.getElementById("vo-1") as Element)).toBe("voiceover");
  });

  it("returns null when the attribute is absent", () => {
    document.body.innerHTML = `<audio id="vo-1"></audio>`;
    expect(audioGroupOf(document.getElementById("vo-1") as Element)).toBeNull();
  });

  // The mirror of resolveAudioGroups' own video case. These two readers used to
  // disagree here: the resolver saw no group, this one answered "voiceover", so
  // preview routed a track through a bus the export would never build (the
  // render enforces audio-only in audioMixer).
  it("returns null for a video, matching resolveAudioGroups", () => {
    document.body.innerHTML = `<video id="v-1" data-audio-group="voiceover"></video>`;
    const el = document.getElementById("v-1") as Element;
    expect(audioGroupOf(el)).toBeNull();
    expect(resolveAudioGroups(document)).toEqual([]);
  });

  it("returns null for an empty attribute, not an empty string", () => {
    document.body.innerHTML = `<audio id="vo-1" data-audio-group=""></audio>`;
    expect(audioGroupOf(document.getElementById("vo-1") as Element)).toBeNull();
    expect(resolveAudioGroups(document)).toEqual([]);
  });

  // Groups do not nest, and the group element is not a member of itself.
  it("returns null for the group element even when it carries the attribute", () => {
    document.body.innerHTML = `<hf-audio-group id="bus" data-audio-group="other"></hf-audio-group>`;
    expect(audioGroupOf(document.getElementById("bus") as Element)).toBeNull();
  });
});

describe("ensureAudioGroupInertStyle", () => {
  it("takes the group element out of layout", () => {
    document.body.innerHTML = `<hf-audio-group id="voiceover"></hf-audio-group>`;
    const el = document.getElementById("voiceover") as HTMLElement;
    ensureAudioGroupInertStyle(document);
    expect(getComputedStyle(el).display).toBe("none");
  });

  // An unknown custom element is an ordinary inline box, so in a flex or grid
  // root it takes a slot: a gap, a justify-content share, and every
  // :nth-child after it shifts. An author rule must not be able to put it
  // back — and an id selector outranks this rule's type selector no matter
  // which stylesheet came last, so `!important` is the only thing holding the
  // contract. Dropping it makes this case fail.
  it("beats an author rule that outranks it on specificity", () => {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style id="author">#voiceover{display:flex}</style>`,
    );
    document.body.innerHTML = `<hf-audio-group id="voiceover"></hf-audio-group>`;
    ensureAudioGroupInertStyle(document);
    expect(getComputedStyle(document.getElementById("voiceover") as HTMLElement).display).toBe(
      "none",
    );
    document.getElementById("author")?.remove();
  });

  it("injects once, however many times it is called", () => {
    ensureAudioGroupInertStyle(document);
    ensureAudioGroupInertStyle(document);
    expect(document.querySelectorAll("#__hf-audio-group-inert")).toHaveLength(1);
  });
});

describe("resolveCarveSourceIds", () => {
  it("expands a group id to its current members", () => {
    document.body.innerHTML = `
      <audio id="vo-1" data-audio-group="voiceover"></audio>
      <audio id="vo-2" data-audio-group="voiceover"></audio>
    `;
    expect(resolveCarveSourceIds(document, ["voiceover"])).toEqual(["vo-1", "vo-2"]);
  });

  it("picks up a member added to the group after the carve was set (analysis-time, not frozen)", () => {
    document.body.innerHTML = `
      <audio id="vo-1" data-audio-group="voiceover"></audio>
      <audio id="vo-2" data-audio-group="voiceover"></audio>
    `;
    expect(resolveCarveSourceIds(document, ["voiceover"])).toEqual(["vo-1", "vo-2"]);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<audio id="vo-3" data-audio-group="voiceover"></audio>`,
    );
    expect(resolveCarveSourceIds(document, ["voiceover"])).toEqual(["vo-1", "vo-2", "vo-3"]);
  });

  it("passes through a plain clip id that still exists", () => {
    document.body.innerHTML = `<audio id="vo-1"></audio>`;
    expect(resolveCarveSourceIds(document, ["vo-1"])).toEqual(["vo-1"]);
  });

  it("drops an id that resolves to nothing — a deleted clip, an empty or vanished group", () => {
    document.body.innerHTML = `<audio id="vo-1"></audio>`;
    expect(resolveCarveSourceIds(document, ["vo-1", "deleted", "no-such-group"])).toEqual(["vo-1"]);
  });

  it("dedupes and preserves first-seen order across a mix of group and plain ids", () => {
    document.body.innerHTML = `
      <audio id="vo-1" data-audio-group="voiceover"></audio>
      <audio id="vo-2" data-audio-group="voiceover"></audio>
    `;
    expect(resolveCarveSourceIds(document, ["voiceover", "vo-1"])).toEqual(["vo-1", "vo-2"]);
  });
});

describe(HF_AUDIO_GROUP_ATTR, () => {
  it("is the attribute name membership is keyed on", () => {
    expect(HF_AUDIO_GROUP_ATTR).toBe("data-audio-group");
  });
});

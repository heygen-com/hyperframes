import { beforeEach, describe, expect, it } from "vitest";
import {
  audioGroupOf,
  HF_AUDIO_GROUP_ATTR,
  resolveAudioGroups,
  resolveCarveSourceIds,
} from "./audioGroups.js";

beforeEach(() => {
  document.body.innerHTML = "";
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

import { beforeEach, describe, expect, it } from "vitest";
import {
  audioGroupOf,
  ensureAudioGroupInertStyle,
  HF_AUDIO_GROUP_ATTR,
  isMemberGroupHidden,
  resolveAudioGroups,
  resolveCarveSourceIds,
  resolveGroupElement,
} from "./audioGroups.js";
import { AUDIO_GROUP_RENDER_ID_ATTR, MEDIA_RENDER_ID_ATTR } from "./compiler/mediaRenderIds.js";

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
    expect(groups).toEqual([
      {
        id: "voiceover",
        label: "Voiceover",
        memberIds: ["vo-1", "vo-2"],
        volume: 1,
        hidden: false,
      },
    ]);
  });

  it("resolves from member tags alone when the group element is absent, label = id", () => {
    document.body.innerHTML = `
      <audio id="vo-1" data-audio-group="narration"></audio>
    `;
    const groups = resolveAudioGroups(document);
    expect(groups).toEqual([
      { id: "narration", label: "narration", memberIds: ["vo-1"], volume: 1, hidden: false },
    ]);
  });

  it("ignores data-audio-group on the group element itself (groups do not nest)", () => {
    document.body.innerHTML = `
      <hf-audio-group id="outer" data-audio-group="outer"></hf-audio-group>
      <audio id="vo-1" data-audio-group="outer"></audio>
    `;
    const groups = resolveAudioGroups(document);
    expect(groups).toEqual([
      { id: "outer", label: "outer", memberIds: ["vo-1"], volume: 1, hidden: false },
    ]);
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

  it("reads the group element's fx chain, automation, volume and hidden", () => {
    document.body.innerHTML = `
      <hf-audio-group id="voiceover" data-fx-chain='{"version":1,"nodes":[]}' data-automation='{"lanes":[]}' data-volume="0.5" data-hidden></hf-audio-group>
      <audio id="vo-1" data-audio-group="voiceover"></audio>
    `;
    const groups = resolveAudioGroups(document);
    expect(groups).toEqual([
      {
        id: "voiceover",
        label: "voiceover",
        memberIds: ["vo-1"],
        fxChain: '{"version":1,"nodes":[]}',
        automation: '{"lanes":[]}',
        volume: 0.5,
        hidden: true,
      },
    ]);
  });

  it("defaults volume to 1 and hidden to false when a group element exists but carries neither", () => {
    document.body.innerHTML = `
      <hf-audio-group id="voiceover"></hf-audio-group>
      <audio id="vo-1" data-audio-group="voiceover"></audio>
    `;
    const [group] = resolveAudioGroups(document);
    expect(group?.volume).toBe(1);
    expect(group?.hidden).toBe(false);
    expect(group?.fxChain).toBeUndefined();
    expect(group?.automation).toBeUndefined();
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

  it("ignores video membership so preview matches the audio-only render", () => {
    document.body.innerHTML = `<video id="v-1" data-audio-group="voiceover"></video>`;
    const el = document.getElementById("v-1") as Element;
    expect(audioGroupOf(el)).toBeNull();
    expect(resolveAudioGroups(document)).toEqual([]);
  });

  it("normalizes an empty membership attribute to null", () => {
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

describe("resolveGroupElement", () => {
  const doc = (html: string): Document => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = html;
    return d;
  };

  it("returns the bus for a real <hf-audio-group>", () => {
    const d = doc(`<hf-audio-group id="vo" data-volume="0.5"></hf-audio-group>`);
    expect(resolveGroupElement(d, "vo")?.tagName.toLowerCase()).toBe("hf-audio-group");
  });

  // The trap: a bare getElementById read a member's OWN fader and chain as the
  // bus's, applying both a second time on the sub-mix.
  it("refuses an <audio> sharing the group id", () => {
    const d = doc(`<audio id="vo" data-audio-group="vo" data-volume="0.5"></audio>`);
    expect(resolveGroupElement(d, "vo")).toBeNull();
  });

  it("refuses an unrelated element sharing the group id", () => {
    const d = doc(`<div id="bg" data-hidden></div>`);
    expect(resolveGroupElement(d, "bg")).toBeNull();
  });

  it("matches a stamped id containing selector syntax without throwing", () => {
    const d = doc("");
    const bus = d.createElement("hf-audio-group");
    bus.setAttribute(MEDIA_RENDER_ID_ATTR, 'vo"\\instance');
    d.body.append(bus);

    expect(resolveGroupElement(d, 'vo"\\instance')).toBe(bus);
  });
});

describe("isMemberGroupHidden", () => {
  const doc = (html: string): Document => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = html;
    return d;
  };

  // Membership is on the MEMBER, so the bus is never an ancestor and
  // `closest("[data-hidden]")` cannot see it.
  it("sees a muted bus that does not nest its member", () => {
    const d = doc(
      `<hf-audio-group id="vo" data-hidden></hf-audio-group>
       <div><audio id="vo-1" data-audio-group="vo"></audio></div>`,
    );
    const member = d.getElementById("vo-1");
    expect(member?.closest("[data-hidden]")).toBeNull();
    expect(isMemberGroupHidden(d, member)).toBe(true);
  });

  it("is false for an unmuted bus and for a member with no group", () => {
    const d = doc(
      `<hf-audio-group id="vo"></hf-audio-group>
       <audio id="vo-1" data-audio-group="vo"></audio>
       <audio id="lone"></audio>`,
    );
    expect(isMemberGroupHidden(d, d.getElementById("vo-1"))).toBe(false);
    expect(isMemberGroupHidden(d, d.getElementById("lone"))).toBe(false);
  });

  it("uses the stamped bus instance when repeated compositions disagree on mute", () => {
    const d = doc(`
      <hf-audio-group id="bed" ${MEDIA_RENDER_ID_ATTR}="bed"></hf-audio-group>
      <audio id="m1" data-audio-group="bed" ${AUDIO_GROUP_RENDER_ID_ATTR}="bed"></audio>
      <hf-audio-group id="bed" ${MEDIA_RENDER_ID_ATTR}="bed__hf2" data-hidden></hf-audio-group>
      <audio id="m2" data-audio-group="bed" ${AUDIO_GROUP_RENDER_ID_ATTR}="bed__hf2"></audio>
    `);

    expect(isMemberGroupHidden(d, d.getElementById("m1"))).toBe(false);
    expect(isMemberGroupHidden(d, d.getElementById("m2"))).toBe(true);
  });
});

describe("resolveCarveSourceIds — empty group", () => {
  it("drops an empty group's own bus id instead of returning it as a clip", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<hf-audio-group id="voiceover"></hf-audio-group>`;
    // No members, so the group resolves to nothing; its element must not pass
    // the existence check as if it were a clip the analysis could read.
    expect(resolveCarveSourceIds(d, ["voiceover"])).toEqual([]);
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

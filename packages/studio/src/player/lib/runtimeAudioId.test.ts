// @vitest-environment jsdom

/**
 * The studio → runtime boundary, which nothing else crosses.
 *
 * Studio addresses rows by `buildTimelineElementKey`'s composite
 * `<sourceFile>#<domId>`; every audio predicate in `@hyperframes/core` keys off
 * the live document instead. Both halves have their own passing tests — one
 * with composite keys, one with bare ids — and the mismatch between them lived
 * in the gap. These parse a real document, take the ids the way the UI does,
 * and hand them to the real core predicates.
 */

import { describe, expect, it } from "vitest";
import {
  audioGroupOf,
  isAudibleUnderSolo,
  isGroupHalfLitUnderSolo,
  resolveAudioGroups,
} from "@hyperframes/core/audio-groups";
import { parseTimelineFromDOM } from "./timelineDOM";
import { runtimeAudioId } from "./timelineElementHelpers";

function docWith(body: string): Document {
  const doc = document.implementation.createHTMLDocument("comp");
  doc.body.innerHTML = body;
  return doc;
}

const COMPOSITION = `
  <div data-composition-id="root" data-duration="30"></div>
  <audio id="voice-1" data-start="0" data-duration="10" data-audio-group="voiceover"></audio>
  <audio id="voice-2" data-start="10" data-duration="10" data-audio-group="voiceover"></audio>
  <audio id="music-bed" data-start="0" data-duration="30"></audio>
  <hf-audio-group id="voiceover"></hf-audio-group>
`;

describe("solo ids cross into the runtime", () => {
  it("keeps the soloed clip audible and silences the rest", () => {
    const doc = docWith(COMPOSITION);
    const elements = parseTimelineFromDOM(doc, 30);
    const voice1 = elements.find((el) => el.domId === "voice-1");
    expect(voice1).toBeDefined();
    // The store key is NOT the runtime's id space — that is the whole point.
    expect(voice1?.key).not.toBe("voice-1");

    const soloTargetId = runtimeAudioId(voice1 ?? {});
    expect(soloTargetId).toBe("voice-1");
    const soloed = new Set([soloTargetId as string]);

    const audible = (id: string) => {
      const el = doc.getElementById(id);
      expect(el).not.toBeNull();
      return isAudibleUnderSolo(soloed, (el as Element).id, audioGroupOf(el as Element));
    };
    expect(audible("voice-1")).toBe(true);
    expect(audible("music-bed")).toBe(false);
    // Soloing a member does not open its sibling — group solo is the other button.
    expect(audible("voice-2")).toBe(false);
  });

  it("soloing the group opens every member", () => {
    const doc = docWith(COMPOSITION);
    const group = resolveAudioGroups(doc)[0];
    const soloed = new Set([group.id]);
    for (const id of group.memberIds) {
      const el = doc.getElementById(id) as Element;
      expect(isAudibleUnderSolo(soloed, el.id, audioGroupOf(el))).toBe(true);
    }
    const bed = doc.getElementById("music-bed") as Element;
    expect(isAudibleUnderSolo(soloed, bed.id, audioGroupOf(bed))).toBe(false);
  });

  it("a composite key matches nothing — the regression this file exists for", () => {
    const doc = docWith(COMPOSITION);
    const voice1 = parseTimelineFromDOM(doc, 30).find((el) => el.domId === "voice-1");
    const soloed = new Set([voice1?.key ?? ""]);
    const el = doc.getElementById("voice-1") as Element;
    expect(isAudibleUnderSolo(soloed, el.id, audioGroupOf(el))).toBe(false);
  });
});

describe("group membership ids cross into the runtime", () => {
  it("the ids the timeline hands to onGroupClips are the ids resolveAudioGroups reads back", () => {
    const doc = docWith(COMPOSITION);
    const trackElements = parseTimelineFromDOM(doc, 30).filter(
      (el) => el.tag.toLowerCase() === "audio",
    );
    const clipIds = trackElements.map(runtimeAudioId).filter((id): id is string => id !== null);
    expect(clipIds).toEqual(["voice-1", "voice-2", "music-bed"]);

    // Same space membership is read back in — a composite key here produces a
    // group whose members nothing can find.
    const memberIds = resolveAudioGroups(doc).flatMap((g) => g.memberIds);
    expect(memberIds.every((id) => doc.getElementById(id) !== null)).toBe(true);
    for (const id of memberIds) expect(clipIds).toContain(id);
  });

  // TimelineGroupRow's half-lit state ("some of what's under here still
  // plays") compares its member list against the same soloed set. Built from
  // store keys it never matched, so soloing a member lit nothing on its group.
  it("half-lights the group when one member is soloed", () => {
    const doc = docWith(COMPOSITION);
    const members = parseTimelineFromDOM(doc, 30).filter((el) => el.audioGroup === "voiceover");
    const memberIds = members.map(runtimeAudioId).filter((id): id is string => id !== null);
    expect(memberIds).toEqual(["voice-1", "voice-2"]);

    const soloed = new Set(["voice-1"]);
    expect(isGroupHalfLitUnderSolo(soloed, "voiceover", memberIds)).toBe(true);
    // Store keys are the shape that silently failed.
    const storeKeys = members.map((el) => el.key ?? el.id);
    expect(isGroupHalfLitUnderSolo(soloed, "voiceover", storeKeys)).toBe(false);
    // Soloing the group itself is lit, not half-lit.
    expect(isGroupHalfLitUnderSolo(new Set(["voiceover"]), "voiceover", memberIds)).toBe(false);
  });

  it("an element with no DOM id is not groupable or soloable", () => {
    const doc = docWith(`
      <div data-composition-id="root" data-duration="10"></div>
      <audio data-start="0" data-duration="5"></audio>
    `);
    const [clip] = parseTimelineFromDOM(doc, 10);
    expect(clip).toBeDefined();
    expect(runtimeAudioId(clip)).toBeNull();
  });
});

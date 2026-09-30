import { describe, expect, it } from "vitest";
import {
  audioPillFlags,
  expandToLinkedMembers,
  linkedGestureKeys,
  linkedMembersOf,
  mediaFileKey,
} from "./audioClipLink";

const video = { id: "talk", link: "lk-1" };
const audio = { id: "talk-audio", link: "lk-1" };
const other = { id: "music", link: "lk-2" };
const otherAudio = { id: "music-audio", link: "lk-2" };
const plain = { id: "title" };
const elements = [video, audio, other, otherAudio, plain];

describe("audioPillFlags", () => {
  it("is linked only by data-link, never by a shared file name", () => {
    expect(audioPillFlags({ link: "lk-1" }).linked).toBe(true);
    expect(audioPillFlags({}).linked).toBe(false);
  });

  it("greys a hidden clip and a muted group", () => {
    expect(audioPillFlags({ hidden: true }).muted).toBe(true);
    expect(audioPillFlags({ audioGroupHidden: true }).muted).toBe(true);
  });
});

describe("mediaFileKey", () => {
  it("matches the same file across folders, query strings and case", () => {
    expect(mediaFileKey("assets/City Ride.mp4?v=2")).toBe(mediaFileKey("/preview/city ride.mp4"));
  });
});

describe("expandToLinkedMembers", () => {
  it("adds every partner of a linked clip", () => {
    expect(expandToLinkedMembers(["talk"], elements)).toEqual(new Set(["talk", "talk-audio"]));
  });

  it("leaves unlinked clips alone and does not pull in other groups", () => {
    expect(expandToLinkedMembers(["title"], elements)).toEqual(new Set(["title"]));
    expect(expandToLinkedMembers(["talk-audio", "title"], elements)).toEqual(
      new Set(["talk-audio", "talk", "title"]),
    );
  });

  it("prefers the store key over the id", () => {
    const keyed = [
      { id: "a", key: "k-a", link: "lk-9" },
      { id: "b", key: "k-b", link: "lk-9" },
    ];
    expect(expandToLinkedMembers(["k-a"], keyed)).toEqual(new Set(["k-a", "k-b"]));
  });
});

describe("linkedMembersOf", () => {
  it("returns the group, or the clip alone when unlinked", () => {
    expect(linkedMembersOf(video, elements).map((el) => el.id)).toEqual(["talk", "talk-audio"]);
    expect(linkedMembersOf(plain, elements)).toEqual([plain]);
  });
});

describe("linkedGestureKeys", () => {
  it("drags an unselected linked clip with its partner", () => {
    expect(linkedGestureKeys(new Set(["title"]), video, elements, false)).toEqual(
      new Set(["talk", "talk-audio"]),
    );
  });

  it("keeps a selection that holds the grabbed clip and adds partners", () => {
    expect(linkedGestureKeys(new Set(["talk", "title"]), video, elements, false)).toEqual(
      new Set(["talk", "talk-audio", "title"]),
    );
  });

  it("Alt edits the grabbed clip alone", () => {
    expect(linkedGestureKeys(new Set(["talk", "talk-audio"]), video, elements, true)).toEqual(
      new Set(["talk"]),
    );
  });
});

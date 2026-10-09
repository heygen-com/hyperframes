import { describe, expect, it } from "vitest";
import {
  MEDIA_LINK_ATTR,
  SYNC_ORIGIN_ATTR,
  findSyncPartner,
  formatSyncOffset,
  linkTimingMismatches,
  moveIntoSyncStart,
  slipIntoSyncMediaStart,
  sourceZeroTime,
  syncOffsetFrames,
  mintLinkId,
  readLinkTiming,
  relinkSplitHalves,
} from "./mediaLink";

const attrs = (values: Record<string, string>) => ({
  getAttribute: (name: string) => values[name] ?? null,
});

describe("readLinkTiming", () => {
  it("defaults media-start to 0 and playback-rate to 1", () => {
    expect(readLinkTiming(attrs({ "data-start": "2", "data-duration": "6" }))).toEqual({
      start: 2,
      duration: 6,
      mediaStart: 0,
      playbackRate: 1,
    });
  });

  it("reads data-playback-start as the media-start alias", () => {
    expect(readLinkTiming(attrs({ "data-playback-start": "1.5" })).mediaStart).toBe(1.5);
  });

  it("lets data-playback-start win over data-media-start, as playback does", () => {
    const both = attrs({ "data-playback-start": "0", "data-media-start": "0.5" });
    expect(readLinkTiming(both).mediaStart).toBe(0);
  });
});

describe("linkTimingMismatches", () => {
  const base = {
    "data-start": "2",
    "data-duration": "6",
    "data-media-start": "1",
    "data-playback-rate": "1",
  };

  it("is empty for members in sync, treating absent defaults as equal", () => {
    expect(
      linkTimingMismatches([
        attrs(base),
        attrs({ "data-start": "2", "data-duration": "6", "data-media-start": "1" }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ["data-start", "start"],
    ["data-duration", "duration"],
    ["data-media-start", "media-start"],
    ["data-playback-rate", "playback-rate"],
  ])("names %s when it drifts", (attr, field) => {
    expect(linkTimingMismatches([attrs(base), attrs({ ...base, [attr]: "3" })])).toEqual([field]);
  });

  it("ignores sub-millisecond float noise", () => {
    expect(linkTimingMismatches([attrs(base), attrs({ ...base, "data-start": "2.0004" })])).toEqual(
      [],
    );
  });
});

describe("mintLinkId", () => {
  it("returns the first lk-N not already taken", () => {
    expect(mintLinkId([])).toBe("lk-1");
    expect(mintLinkId(["lk-1", "lk-2", "lk-4"])).toBe("lk-3");
  });
});

describe("relinkSplitHalves", () => {
  function doc(html: string): Document {
    document.body.innerHTML = html;
    return document;
  }

  it("gives each linked group's right halves one fresh shared id", () => {
    const d = doc(`
      <video id="v" data-link="lk-1"></video><video id="v-split" data-link="lk-1"></video>
      <audio id="a" data-link="lk-1"></audio><audio id="a-split" data-link="lk-1"></audio>
      <img id="i" /><img id="i-split" />`);
    relinkSplitHalves(d, ["v-split", "a-split", "i-split"]);
    const link = (id: string) => d.getElementById(id)?.getAttribute(MEDIA_LINK_ATTR) ?? null;
    expect(link("v")).toBe("lk-1");
    expect(link("a")).toBe("lk-1");
    expect(link("v-split")).toBe("lk-2");
    expect(link("a-split")).toBe("lk-2");
    expect(link("i-split")).toBeNull();
  });

  it("keeps the source origin when only one member of an unlinked pair is cut", () => {
    const d = doc(`
      <video id="v" data-sync-origin="lk-1" data-start="0" data-duration="10"></video>
      <audio id="a" data-sync-origin="lk-1" data-start="0" data-duration="4"></audio>
      <audio id="a-split" data-sync-origin="lk-1" data-start="4" data-duration="6"></audio>`);
    relinkSplitHalves(d, ["a-split"]);
    const right = d.getElementById("a-split");
    expect(right?.getAttribute(SYNC_ORIGIN_ATTR)).toBe("lk-1");
    expect(right && findSyncPartner(right)?.id).toBe("v");
  });

  it("mints distinct ids for distinct groups", () => {
    const d = doc(`
      <video id="v" data-link="lk-1"></video><video id="v2" data-link="lk-1"></video>
      <video id="w" data-link="lk-7"></video><video id="w2" data-link="lk-7"></video>`);
    relinkSplitHalves(d, ["v2", "w2"]);
    const ids = ["v2", "w2"].map((id) => d.getElementById(id)?.getAttribute(MEDIA_LINK_ATTR));
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain("lk-1");
    expect(ids).not.toContain("lk-7");
  });
});

describe("relinkSplitHalves sync origin", () => {
  it("gives right halves their own shared sync origin, even when unlinked", () => {
    document.body.innerHTML = `
      <video id="v" data-sync-origin="lk-1"></video><video id="v2" data-sync-origin="lk-1"></video>
      <audio id="a" data-sync-origin="lk-1"></audio><audio id="a2" data-sync-origin="lk-1"></audio>`;
    relinkSplitHalves(document, ["v2", "a2"]);
    const origin = (id: string) => document.getElementById(id)?.getAttribute(SYNC_ORIGIN_ATTR);
    expect(origin("v")).toBe("lk-1");
    expect(origin("a")).toBe("lk-1");
    expect(origin("v2")).not.toBe("lk-1");
    expect(origin("v2")).toBe(origin("a2"));
  });
});

describe("sync offset", () => {
  const clip = (start: number, mediaStart = 0, playbackRate = 1) => ({
    start,
    mediaStart,
    playbackRate,
  });

  it("places source zero at start minus media-start over rate", () => {
    expect(sourceZeroTime(clip(4, 2, 2))).toBe(3);
  });

  it("is zero for a pair in sync, whatever their shared media start", () => {
    expect(syncOffsetFrames(clip(2, 1), clip(2, 1), 30)).toBe(0);
    expect(syncOffsetFrames(clip(3, 2), clip(2, 1), 30)).toBe(0);
  });

  it("is signed from the clip's side: late is positive, and the partner reads the negation", () => {
    expect(syncOffsetFrames(clip(2 + 10 / 30), clip(2), 30)).toBe(10);
    expect(syncOffsetFrames(clip(2), clip(2 + 10 / 30), 30)).toBe(-10);
  });

  it("counts media start: a slipped clip is out of sync in place", () => {
    expect(syncOffsetFrames(clip(2, 0.5), clip(2, 0), 30)).toBe(-15);
  });

  it("divides media start by the shared rate", () => {
    expect(syncOffsetFrames(clip(2, 1, 2), clip(2, 0, 2), 30)).toBe(-15);
  });

  it("has no offset when the rates differ", () => {
    expect(syncOffsetFrames(clip(2, 0, 1.5), clip(2, 0, 1), 30)).toBeNull();
  });

  it("formats frames, then seconds:frames past one second", () => {
    expect(formatSyncOffset(10, 30)).toBe("+10");
    expect(formatSyncOffset(-51, 30)).toBe("-1:21");
    expect(formatSyncOffset(30, 30)).toBe("+1:00");
    expect(formatSyncOffset(-3, 24)).toBe("-3");
  });

  it("moves the clip onto its partner, or refuses before zero", () => {
    expect(moveIntoSyncStart(clip(2.5, 0.5), clip(1, 0))).toBeCloseTo(1.5);
    expect(syncOffsetFrames(clip(1.5, 0.5), clip(1, 0), 30)).toBe(0);
    expect(moveIntoSyncStart(clip(0, 2), clip(0, 0))).toBeCloseTo(2);
    expect(moveIntoSyncStart(clip(1, 0), clip(0, 2))).toBeNull();
  });

  it("slips the clip's media in place, scaled by rate, or refuses before the file start", () => {
    expect(slipIntoSyncMediaStart(clip(3, 0), clip(2, 0))).toBeCloseTo(1);
    expect(slipIntoSyncMediaStart(clip(3, 0, 2), clip(2, 0, 2))).toBeCloseTo(2);
    expect(syncOffsetFrames(clip(3, 2, 2), clip(2, 0, 2), 30)).toBe(0);
    expect(slipIntoSyncMediaStart(clip(1, 0), clip(2, 0))).toBeNull();
  });
});

describe("findSyncPartner", () => {
  it("finds the opposite kind sharing the origin, preferring the most shared timeline", () => {
    document.body.innerHTML = `<div data-composition-id="m">
      <video id="v" data-sync-origin="lk-1" data-start="0" data-duration="4"></video>
      <video id="v2" data-sync-origin="lk-1" data-start="4" data-duration="4"></video>
      <audio id="a" data-sync-origin="lk-1" data-start="4.2" data-duration="4"></audio>
      <audio id="x" data-sync-origin="lk-9" data-start="4" data-duration="4"></audio></div>`;
    const byId = (id: string) => document.getElementById(id);
    const a = byId("a");
    const x = byId("x");
    expect(a && findSyncPartner(a)?.id).toBe("v2");
    expect(x && findSyncPartner(x)).toBeNull();
  });

  it.each(['data-composition-id="child"', 'data-composition-file="child.html"'])(
    "never takes a partner from a nested composition (%s) reusing the origin",
    (host) => {
      document.body.innerHTML = `<div data-composition-id="m">
      <video id="v" data-sync-origin="lk-1" data-start="0" data-duration="4"></video>
      <div ${host}>
        <audio id="ca" data-sync-origin="lk-1" data-start="0" data-duration="4"></audio>
      </div></div>`;
      const v = document.getElementById("v");
      expect(v && findSyncPartner(v)).toBeNull();
    },
  );
});

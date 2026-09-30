import { describe, expect, it } from "vitest";
import {
  MEDIA_LINK_ATTR,
  linkTimingMismatches,
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

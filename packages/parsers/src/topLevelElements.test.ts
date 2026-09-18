import { describe, expect, it } from "vitest";
import { topLevelElements, trackKindOf, type StructureNode } from "./topLevelElements.js";

type N = StructureNode<N> & { id?: string };
const n = (tag: string, attrs: Record<string, string> = {}, children: N[] = []): N => ({
  tag,
  attrs,
  children,
  id: attrs.id,
});

describe("topLevelElements", () => {
  it("returns timed elements and sub-composition hosts, descending untimed wrappers", () => {
    const root = n("div", {}, [
      n("div", {}, [n("video", { id: "v" })]),
      n("div", { "data-composition-id": "intro", "data-start": "0", id: "host" }, [
        n("div", { "data-start": "1", id: "inner" }),
      ]),
      n("div", { "data-start": "2", id: "t" }, [n("span", { "data-start": "3", id: "nested" })]),
      n("script", { "data-start": "9", id: "s" }),
      n("NOSCRIPT", { "data-start": "9", id: "ns" }),
      n("div", { "data-track-index": "2", id: "lane" }, [n("div", { id: "deep" })]),
      n("IMG", { id: "pic" }),
      n("div", { class: "clip", id: "classOnly" }),
      n("div", { "data-duration": "4", id: "durOnly" }),
    ]);
    expect(topLevelElements(root).map((e) => e.id)).toEqual(["v", "host", "t", "lane", "pic"]);
  });
});

describe("trackKindOf", () => {
  it.each([
    [n("div", { "data-track-kind": "Captions" }), "captions", "attribute"],
    [n("audio"), "audio", "tag"],
    [n("VIDEO"), "video", "tag"],
    [
      n("div", { class: "x caption-line", "data-composition-src": "a.html" }),
      "captions",
      "legacy-captions",
    ],
    [n("div", { "data-composition-src": "a.html" }), "graphics", "sub-composition"],
    [n("div", { "data-composition-id": "captions" }), "captions", "legacy-captions"],
    [
      n("div", { "data-track-kind": "bogus", "data-composition-id": "x" }),
      "graphics",
      "sub-composition",
    ],
  ])("%#", (node, kind, source) => {
    expect(trackKindOf(node)).toEqual({ kind, source });
  });
});

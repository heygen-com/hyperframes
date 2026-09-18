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
      n("script"),
    ]);
    expect(topLevelElements(root).map((e) => e.id)).toEqual(["v", "host", "t"]);
  });
});

describe("trackKindOf", () => {
  it.each([
    [n("div", { "data-track-kind": "Captions" }), "captions", "attribute"],
    [n("audio"), "audio", "tag"],
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

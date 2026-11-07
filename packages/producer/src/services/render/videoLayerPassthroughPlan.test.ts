import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { inspectVideoLayout } from "./videoLayerPassthroughPlan.js";

type Style = Record<string, string>;
const base: Style = {
  opacity: "1",
  transform: "none",
  filter: "none",
  clipPath: "none",
  maskImage: "none",
  mixBlendMode: "normal",
  visibility: "visible",
  display: "block",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  zIndex: "auto",
  objectFit: "cover",
};

class Fake {
  children: Fake[] = [];
  querySelectorAll: () => Fake[] = () => [];
  constructor(
    readonly tagName: string,
    readonly attrs: string[] = [],
    readonly style: Style = {},
    readonly rect = { left: 0, top: 0, width: 1920, height: 1080 },
    public parentElement: Fake | null = null,
  ) {
    parentElement?.children.push(this);
  }
  hasAttribute(name: string) {
    return this.attrs.includes(name);
  }
  closest(): Fake | null {
    for (let e = this.parentElement; e; e = e.parentElement) {
      if (e.hasAttribute("data-composition-id")) return e;
    }
    return null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  descendants(): Fake[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  contains(other: Fake) {
    return this.descendants().includes(other);
  }
  compareDocumentPosition() {
    return 0;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let saved: Record<string, unknown>;

function install(html: Fake, body: Fake, video: Fake, all: Fake[]) {
  saved = {
    document: g.document,
    window: g.window,
    getComputedStyle: g.getComputedStyle,
    Node: g.Node,
  };
  g.window = {};
  g.Node = { DOCUMENT_POSITION_PRECEDING: 2 };
  g.getComputedStyle = (e: Fake) => ({ ...base, ...e.style });
  g.document = {
    documentElement: html,
    body,
    getElementById: () => video,
    querySelectorAll: () => all.filter((e) => e.hasAttribute("data-composition-id")),
  };
  body.querySelectorAll = () => all;
}

function page(wrapperStyle: Style, subStyle?: Style) {
  const html = new Fake("HTML");
  const body = new Fake("BODY", [], {}, undefined, html);
  const root = new Fake(
    "DIV",
    ["data-composition-id"],
    { backgroundColor: "rgb(0, 0, 0)" },
    undefined,
    body,
  );
  const wrapper = new Fake("DIV", [], wrapperStyle, undefined, root);
  const video = new Fake("VIDEO", [], {}, undefined, wrapper);
  const all = [root, wrapper, video];
  if (subStyle) all.push(new Fake("DIV", ["data-composition-id"], subStyle, undefined, wrapper));
  install(html, body, video, all);
  return video;
}

describe("inspectVideoLayout", () => {
  beforeEach(() => undefined);
  afterEach(() => Object.assign(g, saved));

  it("accepts a clear wrapper under a painted composition root", () => {
    page({});
    expect(inspectVideoLayout("v", 1920, 1080, 0)).toEqual({ fit: "cover" });
  });

  it("refuses a wrapper with its own background", () => {
    page({ backgroundColor: "rgb(0, 0, 0)" });
    expect(inspectVideoLayout("v", 1920, 1080, 0)).toEqual({ reason: "ancestor_background" });
  });

  it("refuses a sub-composition with a tint", () => {
    page({}, { backgroundColor: "rgba(0, 0, 0, 0.4)" });
    expect(inspectVideoLayout("v", 1920, 1080, 0)).toEqual({ reason: "subcomposition_background" });
  });
});

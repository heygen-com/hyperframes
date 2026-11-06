// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  findBoardFile,
  groupByAct,
  readBoardFrames,
  stillPath,
  touchesBoard,
} from "./storyboardBoard";
import { frameStart } from "./StoryboardBoardView";

const page = (body: string) => new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");

describe("findBoardFile", () => {
  it("finds the board in boards/, whatever its case", () => {
    expect(findBoardFile(["index.html", "boards/StoryBoard.html"])).toBe("boards/StoryBoard.html");
  });

  it("prefers a root copy over the one in boards/, as Desktop does", () => {
    expect(findBoardFile(["boards/storyboard.html", "storyboard.html"])).toBe("storyboard.html");
  });

  it("does not take a board from any other folder", () => {
    expect(findBoardFile(["old/boards/storyboard.html", "compositions/storyboard.html"])).toBe(
      null,
    );
  });
});

describe("touchesBoard", () => {
  it("counts the page, a still beside it and the plan, and nothing else", () => {
    const board = "boards/storyboard.html";
    expect(touchesBoard("boards/storyboard.html", board)).toBe(true);
    expect(touchesBoard("boards/stills/frame-03-at-9.4s.png", board)).toBe(true);
    expect(touchesBoard("STORYBOARD.md", board)).toBe(true);
    expect(touchesBoard("index.html", board)).toBe(false);
    expect(touchesBoard("compositions/s1.html", board)).toBe(false);
  });

  it("does not take every project write as the board's when the board is at the root", () => {
    expect(touchesBoard("index.html", "storyboard.html")).toBe(false);
  });
});

describe("stillPath", () => {
  it("resolves a still against the page's own folder", () => {
    expect(stillPath("boards/storyboard.html", "stills/frame-00-at-1.5s.png")).toBe(
      "boards/stills/frame-00-at-1.5s.png",
    );
    expect(stillPath("boards/storyboard.html", "../assets/a%20b.png?v=2")).toBe("assets/a b.png");
  });

  it("refuses a still outside the project or on another host", () => {
    expect(stillPath("boards/storyboard.html", "../../etc/passwd")).toBe(null);
    expect(stillPath("boards/storyboard.html", "https://example.com/a.png")).toBe(null);
    expect(stillPath("boards/storyboard.html", "data:image/png;base64,AAAA")).toBe(null);
    expect(stillPath("boards/storyboard.html", "")).toBe(null);
  });
});

describe("readBoardFrames", () => {
  it("reads the recipe's page: act, number, title, time, still and words", () => {
    const frames = readBoardFrames(
      page(`
        <section class="act">Act 1: Cold open</section>
        <div class="frame">
          <img src="stills/frame-00-at-1.5s.png" alt="" />
          <div class="title">01: Three exits</div>
          <div class="time">0.0 to 5.6s</div>
          <p class="words">Badges 1, 2, 3 land on the words.</p>
        </div>
        <section class="act">Act 2: The filing</section>
        <div class="frame">
          <img src="stills/frame-01-at-6s.png" alt="" />
          <div class="title">02: One goes to OpenAI</div>
          <div class="time">5.6–9.4s</div>
        </div>`),
    );
    expect(frames).toEqual([
      {
        number: "01",
        title: "Three exits",
        act: "Act 1: Cold open",
        time: "0.0 to 5.6s",
        still: "stills/frame-00-at-1.5s.png",
        words: "Badges 1, 2, 3 land on the words.",
      },
      {
        number: "02",
        title: "One goes to OpenAI",
        act: "Act 2: The filing",
        time: "5.6 to 9.4s",
        still: "stills/frame-01-at-6s.png",
        words: "",
      },
    ]);
  });

  it("numbers frames by place when the page gives none, and keeps a nested frame inside its parent", () => {
    const frames = readBoardFrames(
      page(`
        <div class="frame"><div class="title">The hook</div><div class="frame"><img src="a.png"></div></div>
        <div class="frame"><div class="title">The turn</div></div>`),
    );
    expect(frames.map((f) => [f.number, f.title])).toEqual([
      ["01", "The hook"],
      ["02", "The turn"],
    ]);
  });

  it("finds no frames on a page that marks them another way", () => {
    expect(
      readBoardFrames(page(`<div class="cell" id="frame-01"><img src="a.png"></div>`)),
    ).toEqual([]);
  });
});

describe("groupByAct", () => {
  it("keeps film order and starts a group at each act change", () => {
    const frame = (act: string, number: string) => ({
      act,
      number,
      title: "",
      time: "",
      still: "",
      words: "",
    });
    const groups = groupByAct([
      frame("", "01"),
      frame("A", "02"),
      frame("A", "03"),
      frame("B", "04"),
    ]);
    expect(groups.map((g) => [g.act, g.frames.map((f) => f.number)])).toEqual([
      ["", ["01"]],
      ["A", ["02", "03"]],
      ["B", ["04"]],
    ]);
  });
});

describe("frameStart", () => {
  it("reads a frame's start from its range", () => {
    expect(frameStart("9.4 to 15.7s")).toBe(9.4);
    expect(frameStart("")).toBe(null);
  });
});

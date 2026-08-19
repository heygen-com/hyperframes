import { describe, expect, it } from "vitest";
import { buildCommentsFile, draftEntries, parseCommentsFile, passForFrames } from "./frameComments";

const frames = [
  { index: 1, status: "built" as const, src: "compositions/frames/01-hook.html", title: "Hook" },
  {
    index: 2,
    status: "built" as const,
    src: "compositions/frames/02-thesis.html",
    title: "Thesis",
  },
  { index: 3, status: "built" as const, src: "compositions/frames/03-proof.html", title: "Proof" },
];

describe("passForFrames", () => {
  it("maps the furthest status to the review pass", () => {
    expect(passForFrames([{ status: "outline" }, { status: "outline" }])).toBe("storyboard");
    expect(passForFrames([{ status: "outline" }, { status: "built" }])).toBe("sketch");
    expect(passForFrames([{ status: "built" }, { status: "animated" }])).toBe("final");
  });
});

describe("draftEntries", () => {
  it("keeps only non-empty drafts, in board order, with src/title echoed", () => {
    const entries = draftEntries(frames, { 3: "swap the chart", 1: "  ", 2: "tighter kerning" });
    expect(entries).toEqual([
      { frame: 2, src: frames[1]?.src, title: "Thesis", text: "tighter kerning" },
      { frame: 3, src: frames[2]?.src, title: "Proof", text: "swap the chart" },
    ]);
  });
});

describe("parseCommentsFile", () => {
  it("reads a well-formed file", () => {
    const parsed = parseCommentsFile(
      JSON.stringify({
        version: 1,
        pass: "sketch",
        submitted_at: "2026-07-10T00:00:00Z",
        comments: [{ frame: 2, text: "hi" }],
      }),
    );
    expect(parsed?.pass).toBe("sketch");
    expect(parsed?.comments).toEqual([{ frame: 2, src: undefined, title: undefined, text: "hi" }]);
  });

  it("treats empty or malformed input as no file", () => {
    expect(parseCommentsFile("")).toBeNull();
    expect(parseCommentsFile("not json")).toBeNull();
    expect(parseCommentsFile(JSON.stringify({ comments: "nope" }))).toBeNull();
  });

  it("drops malformed entries but keeps the valid ones", () => {
    const parsed = parseCommentsFile(
      JSON.stringify({ comments: [{ frame: 1, text: "ok" }, { frame: "x" }, null] }),
    );
    expect(parsed?.comments).toEqual([{ frame: 1, src: undefined, title: undefined, text: "ok" }]);
  });
});

describe("buildCommentsFile", () => {
  it("merges an unconsumed previous batch: new frames win, others stay", () => {
    const previous = parseCommentsFile(
      JSON.stringify({
        version: 1,
        pass: "sketch",
        submitted_at: "2026-07-10T00:00:00Z",
        comments: [
          { frame: 1, text: "old note on hook" },
          { frame: 3, text: "old note on proof" },
        ],
      }),
    );
    const file = buildCommentsFile(
      frames,
      { 3: "new note on proof" },
      previous,
      "2026-07-10T01:00:00Z",
    );
    expect(file.pass).toBe("sketch");
    expect(file.submitted_at).toBe("2026-07-10T01:00:00Z");
    expect(file.comments.map((c) => [c.frame, c.text])).toEqual([
      [1, "old note on hook"],
      [3, "new note on proof"],
    ]);
  });

  it("writes a fresh batch when no previous file exists", () => {
    const file = buildCommentsFile(frames, { 2: "tighter" }, null, "2026-07-10T01:00:00Z");
    expect(file.version).toBe(1);
    expect(file.comments).toEqual([
      { frame: 2, src: frames[1]?.src, title: "Thesis", text: "tighter" },
    ]);
  });
});

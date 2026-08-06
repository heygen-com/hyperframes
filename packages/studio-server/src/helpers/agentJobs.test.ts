import { describe, expect, it } from "vitest";
import {
  readActivity,
  readOverlayState,
  readTimelineSkeletons,
  stripAgentDeclarations,
} from "./agentJobs";

/** How an agent writes a declaration: inline, in an HTML comment, in prose. */
function declare(body: string): string {
  return `<!-- hf:timeline ${body} -->`;
}

/** The same text as Claude Code puts it on stdout. */
function claudeSays(text: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
}

/** The same text as Codex puts it on stdout. */
function codexSays(text: string): string {
  return JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } });
}

const TWO_CLIPS = declare(
  '{"adding":[{"track":0,"start":1,"end":3,"label":"Hero"},{"track":2,"start":3,"end":4.5}]}',
);

describe("readTimelineSkeletons", () => {
  it("reads what the agent said it is about to add", () => {
    expect(readTimelineSkeletons("custom", `Adding two clips. ${TWO_CLIPS}`)).toEqual([
      { track: 0, start: 1, end: 3, label: "Hero" },
      { track: 2, start: 3, end: 4.5 },
    ]);
  });

  // The declaration is the same whatever the harness wraps it in.
  it("reads it the same out of every harness' envelope", () => {
    const expected = [
      { track: 0, start: 1, end: 3, label: "Hero" },
      { track: 2, start: 3, end: 4.5 },
    ];
    expect(readTimelineSkeletons("claude", claudeSays(TWO_CLIPS))).toEqual(expected);
    expect(readTimelineSkeletons("codex", codexSays(TWO_CLIPS))).toEqual(expected);
    expect(readTimelineSkeletons("custom", TWO_CLIPS)).toEqual(expected);
  });

  // One bad entry costs its own skeleton, not its siblings'.
  it("drops an entry with no width and keeps the rest", () => {
    expect(
      readTimelineSkeletons(
        "custom",
        declare('{"adding":[{"track":0,"start":2,"end":2},{"track":1,"start":0,"end":1}]}'),
      ),
    ).toEqual([{ track: 1, start: 0, end: 1 }]);
  });

  it("drops an entry whose track is not a whole non-negative number", () => {
    expect(
      readTimelineSkeletons(
        "custom",
        declare(
          '{"adding":[{"track":1.5,"start":0,"end":1},{"track":-1,"start":0,"end":1},{"track":3,"start":0,"end":1}]}',
        ),
      ),
    ).toEqual([{ track: 3, start: 0, end: 1 }]);
  });

  it("keeps the cap's worth of entries and drops the overflow", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ track: i, start: 0, end: 1 }));
    const read = readTimelineSkeletons("custom", declare(JSON.stringify({ adding: many })));
    expect(read).toHaveLength(64);
    expect(read?.[0]).toEqual({ track: 0, start: 0, end: 1 });
  });

  // A declaration Studio cannot read must not wipe one it already had.
  it("says nothing when the declaration is not readable", () => {
    expect(readTimelineSkeletons("custom", "<!-- hf:timeline {not json} -->")).toBeNull();
    expect(readTimelineSkeletons("custom", "<!-- hf:timeline -->")).toBeNull();
    expect(readTimelineSkeletons("custom", "no declaration here")).toBeNull();
  });

  it("takes the last declaration in a chunk, replacing the earlier one", () => {
    const text = `${declare('{"adding":[{"track":0,"start":0,"end":1}]}')} then ${declare('{"adding":[{"track":9,"start":2,"end":3}]}')}`;
    expect(readTimelineSkeletons("custom", text)).toEqual([{ track: 9, start: 2, end: 3 }]);
  });

  // How an agent says it is no longer adding anything.
  it("reads an empty list as a real declaration, not as silence", () => {
    expect(readTimelineSkeletons("custom", declare('{"adding":[]}'))).toEqual([]);
  });

  it("keeps the file an entry names, so a declaration can be scoped", () => {
    expect(
      readTimelineSkeletons(
        "custom",
        declare('{"adding":[{"track":0,"start":0,"end":1,"file":"scenes/intro.html"}]}'),
      ),
    ).toEqual([{ track: 0, start: 0, end: 1, file: "scenes/intro.html" }]);
  });
});

describe("declarations living side by side", () => {
  const both = `<!-- hf:overlay {"kind":"editing"} --> Adding a clip. ${declare('{"adding":[{"track":1,"start":0,"end":2}]}')}`;

  it("reads each without disturbing the other", () => {
    expect(readOverlayState("custom", both)).toEqual({ kind: "editing" });
    expect(readTimelineSkeletons("custom", both)).toEqual([{ track: 1, start: 0, end: 2 }]);
  });

  // Left in, a declaration becomes the run's activity line and the tray shows
  // raw JSON at the user.
  it("takes both out of what the run reports it is doing", () => {
    expect(stripAgentDeclarations(both)).toBe("Adding a clip.");
    expect(readActivity("custom", both)).toBe("Adding a clip.");
  });

  it("leaves prose carrying no declaration alone", () => {
    expect(stripAgentDeclarations("Widened the hero.")).toBe("Widened the hero.");
  });
});

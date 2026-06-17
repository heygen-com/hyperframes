import { describe, it, expect } from "vitest";
import { parseStoryboard } from "./parseStoryboard.js";

const STRUCTURED = `---
format: 1920x1080
message: "Ship a launch video in an afternoon"
arc: Problem → Solution
audience: indie devs on X
---

## Frame 1 — Hook
- duration: 4s
- transition_in: cut
- status: built
- src: compositions/frames/01-hook.html

A bold opening line lands on the beat.

## Frame 2 — The feature in action
- duration: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-feature.html

The diff animates line by line as the narration says "...".
`;

describe("parseStoryboard", () => {
  it("parses global frontmatter direction", () => {
    const { globals } = parseStoryboard(STRUCTURED);
    expect(globals.format).toBe("1920x1080");
    expect(globals.message).toBe("Ship a launch video in an afternoon");
    expect(globals.arc).toBe("Problem → Solution");
    expect(globals.audience).toBe("indie devs on X");
    expect(globals.extra).toEqual({});
  });

  it("parses ordered frames with metadata and narrative", () => {
    const { frames } = parseStoryboard(STRUCTURED);
    expect(frames).toHaveLength(2);

    const [f1, f2] = frames;
    expect(f1).toMatchObject({
      index: 1,
      number: 1,
      title: "Hook",
      status: "built",
      src: "compositions/frames/01-hook.html",
      duration: "4s",
      durationSeconds: 4,
      transitionIn: "cut",
    });
    expect(f1.narrative).toBe("A bold opening line lands on the beat.");

    expect(f2).toMatchObject({
      index: 2,
      number: 2,
      title: "The feature in action",
      status: "animated",
      durationSeconds: 6,
      transitionIn: "crossfade",
    });
    expect(f2.narrative).toContain("animates line by line");
  });

  it("defaults status to outline and reports no warnings for clean input", () => {
    const { frames, warnings } = parseStoryboard(STRUCTURED);
    expect(frames.every((f) => f.status !== undefined)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("defaults missing status to outline", () => {
    const { frames } = parseStoryboard("## Frame 1 — Idea\n\nJust a thought.");
    expect(frames[0].status).toBe("outline");
    expect(frames[0].src).toBeUndefined();
    expect(frames[0].narrative).toBe("Just a thought.");
  });

  it("warns on unknown status and falls back to outline, preserving the raw value", () => {
    const { frames, warnings } = parseStoryboard("## Frame 1\n- status: wip\n");
    expect(frames[0].status).toBe("outline");
    expect(frames[0].extra.status).toBe("wip");
    expect(warnings.some((w) => w.frameIndex === 1 && /unknown status/i.test(w.message))).toBe(
      true,
    );
  });

  it("warns on unparseable duration", () => {
    const { frames, warnings } = parseStoryboard("## Frame 1\n- duration: a while\n");
    expect(frames[0].duration).toBe("a while");
    expect(frames[0].durationSeconds).toBeUndefined();
    expect(warnings.some((w) => /could not parse duration/i.test(w.message))).toBe(true);
  });

  it("preserves unknown frontmatter and frame metadata keys in extra", () => {
    const { globals, frames } = parseStoryboard(
      "---\nmood: playful\n---\n## Frame 1\n- voice: Rachel\n- status: built\n",
    );
    expect(globals.extra.mood).toBe("playful");
    expect(frames[0].extra.voice).toBe("Rachel");
  });

  it("parses scene, voiceover, and poster fields with aliases", () => {
    const md = `## Frame 1 — Hook
- scene: A bold line punches in on the beat
- vo: "Ship a launch video in an afternoon."
- poster: 2.5s

Longer narrative here.`;
    const { frames } = parseStoryboard(md);
    expect(frames[0].scene).toBe("A bold line punches in on the beat");
    expect(frames[0].voiceover).toBe("Ship a launch video in an afternoon.");
    expect(frames[0].poster).toBe(2.5);
    expect(frames[0].narrative).toBe("Longer narrative here.");
  });

  it("accepts description/voiceover/narration aliases", () => {
    const { frames } = parseStoryboard(
      "## Frame 1\n- description: one liner\n- voiceover: spoken line\n",
    );
    expect(frames[0].scene).toBe("one liner");
    expect(frames[0].voiceover).toBe("spoken line");
  });

  it("is lenient: accepts Beat/Scene headings at H2 or H3", () => {
    const md = "## Scene 1 — Open\n\nWide shot.\n\n### Beat 2.1 — Punch\n\nClose up.";
    const { frames } = parseStoryboard(md);
    expect(frames).toHaveLength(2);
    expect(frames[0].title).toBe("Open");
    expect(frames[1].number).toBe(2);
  });

  it("keeps deeper sub-headings inside a frame as narrative", () => {
    const md = `## Frame 1 — Demo
- duration: 6s

Intro line.

#### Beats
The diff animates line by line.

## Frame 2 — Close

Ending.`;
    const { frames } = parseStoryboard(md);
    expect(frames).toHaveLength(2);
    expect(frames[0].narrative).toContain("Intro line.");
    expect(frames[0].narrative).toContain("#### Beats");
    expect(frames[0].narrative).toContain("The diff animates line by line.");
    expect(frames[1].title).toBe("Close");
  });

  it("ignores non-frame headings between frames (e.g. Fonts, Color palette)", () => {
    const md = `## Frame 1 — Hook

Opening.

## Fonts

| Role | File |

## Frame 2 — Close

Ending.`;
    const { frames } = parseStoryboard(md);
    expect(frames.map((f) => f.title)).toEqual(["Hook", "Close"]);
    expect(frames[0].narrative).toBe("Opening.");
  });

  it("handles missing/empty input without throwing", () => {
    expect(parseStoryboard("")).toEqual({ globals: { extra: {} }, frames: [], warnings: [] });
    const noFrontmatter = parseStoryboard("# Title\n\nNo frames here.");
    expect(noFrontmatter.frames).toEqual([]);
  });

  it("warns on unterminated frontmatter and treats whole file as body", () => {
    const { frames, warnings } = parseStoryboard("---\nmessage: hi\n## Frame 1\n\nBody.");
    expect(warnings.some((w) => /no closing/i.test(w.message))).toBe(true);
    expect(frames).toHaveLength(1);
  });
});

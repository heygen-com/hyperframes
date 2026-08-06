import { describe, expect, it } from "vitest";
import {
  buildPromptCopyText,
  buildTimelineAgentPrompt,
  buildTimelineElementAgentPrompt,
} from "./timelineAgentPrompt";
import type { TimelinePromptElement } from "./timelineEditing";

describe("buildTimelineAgentPrompt", () => {
  it("includes the selected range, elements, and user request", () => {
    const elements: TimelinePromptElement[] = [
      { id: "title", tag: "div", start: 1, duration: 3, track: 0 },
      { id: "music", tag: "audio", start: 0, duration: 8, track: 2 },
    ];

    const text = buildTimelineAgentPrompt({
      rangeStart: 1,
      rangeEnd: 4,
      elements,
      prompt: "Move the title later and lower the music",
    });

    expect(text).toContain("Time range: 00:01 - 00:04");
    expect(text).toContain("#title (div)");
    expect(text).toContain("#music (audio)");
    expect(text).toContain("Move the title later and lower the music");
  });
});

describe("buildTimelineElementAgentPrompt", () => {
  it("includes the clip context and guidance for agent-based edits", () => {
    expect(
      buildTimelineElementAgentPrompt({
        id: "feature-card",
        tag: "section",
        start: 1.4,
        duration: 1.6,
        track: 1,
        sourceFile: "index.html",
        selector: "#feature-card",
      }),
    ).toContain("If this clip is animated with GSAP");
  });
});

describe("buildPromptCopyText", () => {
  it("returns a trimmed prompt for the copy-prompt action", () => {
    expect(buildPromptCopyText("  Tighten the headline timing  ")).toBe(
      "Tighten the headline timing",
    );
  });
});

describe("a request scoped to one track", () => {
  // Authored 4 packs onto display lane 1. Telling the agent "track 1" sends it
  // to the wrong element on any composition whose tracks have gaps.
  const ON_SPARSE_TRACK: TimelinePromptElement[] = [
    { id: "card", tag: "div", start: 1, duration: 2, track: 1, authoredTrack: 4 },
  ];

  it("names the authored track, not the display lane", () => {
    const text = buildTimelineAgentPrompt({
      rangeStart: 0,
      rangeEnd: 5,
      elements: ON_SPARSE_TRACK,
      prompt: "tighten this",
      track: 4,
    });

    expect(text).toContain('data-track-index="4"');
    expect(text).toContain("#card (div)");
    expect(text).toMatch(/#card .*, track 4$/m);
    expect(text).not.toMatch(/, track 1$/m);
  });

  // Without this the agent has a time window and has to guess.
  it("says where a new element belongs", () => {
    const text = buildTimelineAgentPrompt({
      rangeStart: 0,
      rangeEnd: 5,
      elements: [],
      prompt: "add a caption",
      track: 4,
    });

    expect(text).toContain("about track 4 only");
    expect(text).toContain('Any element you add belongs on that track, with data-track-index="4"');
    expect(text).toContain("Leave every other track alone");
  });

  it("says nothing about a track when the request is not scoped to one", () => {
    const text = buildTimelineAgentPrompt({
      rangeStart: 0,
      rangeEnd: 5,
      elements: ON_SPARSE_TRACK,
      prompt: "tighten this",
    });

    expect(text).not.toContain('data-track-index="');
    expect(text).not.toContain("This request is about track");
    // The element line still reports the authored track, which is what the
    // agent will look for however the request was scoped.
    expect(text).toContain("track 4");
  });

  it("falls back to the display lane for an element with no authored track", () => {
    const text = buildTimelineAgentPrompt({
      rangeStart: 0,
      rangeEnd: 5,
      elements: [{ id: "hero", tag: "h1", start: 0, duration: 1, track: 2 }],
      prompt: "x",
    });

    expect(text).toContain("track 2");
  });
});

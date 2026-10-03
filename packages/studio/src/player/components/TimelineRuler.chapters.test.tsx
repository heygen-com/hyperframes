// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/timelineElement";
import { uniqueTimelineChapters } from "../lib/timelineElementHelpers";
import { chapterTitleFits } from "./TimelineChapterTicks";
import { TimelineRuler } from "./TimelineRuler";
import { defaultTimelineTheme } from "./timelineTheme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ elements: [] });
});

function el(
  partial: Partial<TimelineElement> & Pick<TimelineElement, "id" | "start">,
): TimelineElement {
  return {
    tag: "div",
    duration: 2,
    track: 1,
    ...partial,
  };
}

describe("uniqueTimelineChapters", () => {
  it("keeps one tick per unique start", () => {
    expect(
      uniqueTimelineChapters([
        el({ id: "a", start: 0, chapter: "Hook" }),
        el({ id: "b", start: 0.0004, chapter: "Also hook" }),
        el({ id: "c", start: 4, chapter: "Demo" }),
      ]),
    ).toEqual([
      { start: 0, title: "Hook" },
      { start: 4, title: "Demo" },
    ]);
  });
});

describe("TimelineRuler chapters", () => {
  it("renders one tick per unique start and omits overflowing labels", () => {
    usePlayerStore.setState({
      elements: [
        el({ id: "a", start: 0, chapter: "Hook" }),
        el({ id: "b", start: 4, chapter: "A very long chapter title that should overflow" }),
      ],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineRuler
          major={[0, 5]}
          minor={[0]}
          pps={10}
          trackContentWidth={200}
          totalH={40}
          effectiveDuration={16}
          majorTickInterval={5}
          theme={defaultTimelineTheme}
          contentOrigin={0}
        />,
      );
    });

    const ticks = host.querySelectorAll("[data-timeline-chapter-tick]");
    expect(ticks).toHaveLength(2);
    expect(host.querySelector("[data-timeline-chapter-label]")?.textContent).toBe("Hook");
    const longFits = chapterTitleFits("A very long chapter title that should overflow", 40);
    expect(longFits).toBe(false);
    expect(ticks[1]?.querySelector("[data-timeline-chapter-label]")).toBeNull();
    act(() => root.unmount());
  });
});

import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../core/src/runtime/timelineInspection";
import { formatTimeline } from "./timelineReport";

function event(target: TimelineEvent["targets"][number]): TimelineEvent {
  return {
    start: 0.3,
    end: 1.2,
    kind: "animation",
    relation: "at",
    component: null,
    targets: [target],
    properties: ["opacity"],
    stack: null,
  };
}

describe("timeline target labels", () => {
  it("names the nearest ancestor id when the element has none", () => {
    const report = formatTimeline(
      {
        status: "found",
        candidates: [],
        events: [
          event({
            ref: "hfi:1",
            tag: "span",
            id: "",
            hfId: null,
            classes: ["a-ch"],
            composition: "s06",
            withinId: "a-type",
          }),
        ],
        warnings: [],
        following: [],
        generation: "g",
      },
      {},
      { generation: "g", map: () => [], reused: false },
    );
    expect(report.text).toContain(".a-ch in #a-type");
  });
});

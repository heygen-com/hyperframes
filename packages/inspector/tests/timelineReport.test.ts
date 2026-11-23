import { describe, expect, it } from "vitest";
import { formatTimeline } from "../src/timelineReport";
import type { PageTimeline } from "../src/pageQueries";

const view = { generation: "g", map: () => [], reused: false };

function report(duration: number | undefined, at: number) {
  const raw: PageTimeline = {
    status: "found",
    candidates: [],
    events: [],
    warnings: [],
    following: [],
    generation: null,
    duration,
  };
  return formatTimeline(raw, { at }, view).text;
}

describe("a query past the end of the film", () => {
  it("does not call an unknown duration a film that ends at 0s", () => {
    expect(report(0, 0)).not.toMatch(/past the end/);
    expect(report(undefined, 0)).not.toMatch(/past the end/);
    expect(report(30, 40)).toMatch(/past the end: the film is 30s long/);
  });
});

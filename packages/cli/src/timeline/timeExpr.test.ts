import { describe, expect, it } from "vitest";
import { parseTimeExpression } from "./timeExpr.js";
import type { TimelineRow } from "./describeProject.js";

const row: TimelineRow = {
  ref: "#clip",
  warnings: [],
  id: "clip",
  label: null,
  kind: "video",
  trackKind: "video",
  start: 4,
  duration: 2,
  end: 6,
  absStart: 4,
  absEnd: 6,
  file: "index.html",
  index: 0,
  nested: false,
  host: null,
  hostRow: null,
  children: [],
  trackIndex: 0,
  src: null,
  sourceFile: null,
  volume: null,
  lanes: [],
  playbackRate: null,
  audioGroup: null,
  role: null,
  durationAuthored: true,
  durationSource: "authored",
  pendingReason: null,
  laneError: null,
};

describe("parseTimeExpression", () => {
  it.each([
    ["12.5", 12.5],
    ["+2", 6],
    ["-0.5", 3.5],
    ["30f", 1],
    ["after:#other", 9],
    ["before:#other", 7],
    ["start-of:#other", 7],
    ["end-of:#other", 9],
    ["end", 20],
  ])("parses %s", (expression, seconds) => {
    const result = parseTimeExpression(expression, {
      row,
      duration: 20,
      fps: 30,
      resolveAnchor: (ref) => (ref === "#other" ? { ...row, start: 7, end: 9 } : undefined),
    });
    expect(result).toEqual({ ok: true, seconds });
  });
});

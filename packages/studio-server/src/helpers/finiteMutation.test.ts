import { describe, expect, it } from "vitest";
import { findUnsafeDomPatchValues, findUnsafeMutationValues } from "./finiteMutation";

describe("finiteMutation", () => {
  it("reports non-finite numbers before mutation serialization", () => {
    expect(
      findUnsafeMutationValues({
        type: "set-arc-path",
        segments: [{ curviness: Number.NaN, cp1: { x: Infinity, y: 0 } }],
      }).map((field) => field.path),
    ).toEqual(["body.segments[0].curviness", "body.segments[0].cp1.x"]);
  });

  it("treats null as unsafe because JSON serializes NaN and Infinity to null", () => {
    expect(
      findUnsafeMutationValues({
        type: "update-property",
        property: "x",
        value: null,
      }),
    ).toEqual([{ path: "body.value", reason: "null" }]);
  });

  it("allows explicit DOM patch value removals while rejecting unsafe patch metadata", () => {
    expect(
      findUnsafeDomPatchValues({
        target: { id: "title", selectorIndex: null },
        operations: [{ type: "inline-style", property: "opacity", value: null }],
      }),
    ).toEqual([{ path: "body.target.selectorIndex", reason: "null" }]);
  });

  it("rejects non-finite DOM patch values before JSON serialization can turn them into null", () => {
    expect(
      findUnsafeDomPatchValues({
        target: { id: "title" },
        operations: [{ type: "inline-style", property: "left", value: Number.NaN }],
      }),
    ).toEqual([{ path: "body.operations[0].value", reason: "non-finite-number" }]);
  });
});

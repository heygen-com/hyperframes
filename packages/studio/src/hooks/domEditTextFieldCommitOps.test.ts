import { describe, expect, it } from "vitest";
import type { DomEditTextField } from "../components/editor/domEditing";
import { buildTextFieldChildOperations } from "./domEditTextFieldCommitOps";

function textField(input: {
  key: string;
  value: string;
  tagName?: string;
  inlineStyles?: Record<string, string>;
  source?: DomEditTextField["source"];
}): DomEditTextField {
  return {
    key: input.key,
    label: input.key,
    value: input.value,
    tagName: input.tagName ?? "span",
    attributes: [],
    inlineStyles: input.inlineStyles ?? {},
    computedStyles: {},
    source: input.source ?? "child",
  };
}

describe("buildTextFieldChildOperations", () => {
  it("builds child-scoped text and style operations for changed child fields", () => {
    const originalFields = [
      textField({ key: "first", value: "First", inlineStyles: { color: "red" } }),
      textField({ key: "second", value: "Second", inlineStyles: { "font-size": "24px" } }),
    ];
    const nextFields = [
      originalFields[0],
      textField({
        key: "second",
        value: "Second < &",
        inlineStyles: { "font-size": "24px", color: "#0000ff" },
      }),
    ];

    expect(buildTextFieldChildOperations(originalFields, nextFields)).toEqual([
      {
        type: "text-content",
        property: "text",
        value: "Second < &",
        childSelector: ":scope > span",
        childIndex: 1,
      },
      {
        type: "inline-style",
        property: "color",
        value: "#0000ff",
        childSelector: ":scope > span",
        childIndex: 1,
      },
    ]);
  });

  it("emits null for a removed inline style", () => {
    const originalFields = [
      textField({ key: "first", value: "First", inlineStyles: { color: "red" } }),
    ];
    const nextFields = [textField({ key: "first", value: "First", inlineStyles: {} })];

    expect(buildTextFieldChildOperations(originalFields, nextFields)).toEqual([
      {
        type: "inline-style",
        property: "color",
        value: null,
        childSelector: ":scope > span",
        childIndex: 0,
      },
    ]);
  });

  it("returns null for structural changes, reordered fields, and text nodes", () => {
    const originalFields = [
      textField({ key: "first", value: "First" }),
      textField({ key: "second", value: "Second" }),
    ];

    expect(buildTextFieldChildOperations(originalFields, [originalFields[0]])).toBeNull();
    expect(
      buildTextFieldChildOperations(originalFields, [originalFields[1], originalFields[0]]),
    ).toBeNull();
    expect(
      buildTextFieldChildOperations(originalFields, [
        originalFields[0],
        textField({ key: "second", value: "Second", tagName: "#text", source: "text-node" }),
      ]),
    ).toBeNull();
  });
});

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { HyperframePickerElementInfo } from "@hyperframes/core";
import {
  buildAgentContextPreview,
  buildElementAgentPrompt,
  buildPickerAgentContextPreview,
  buildPickerAgentPrompt,
} from "./domEditingAgentPrompt";
import type { DomEditSelection } from "./domEditingTypes";

function makeSelection(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    element: document.createElement("div"),
    label: "Headline",
    tagName: "div",
    sourceFile: "hero.html",
    compositionPath: "hero.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    id: "headline-1",
    selector: "#headline-1",
    selectorIndex: 0,
    boundingBox: { x: 10, y: 20, width: 300, height: 40 },
    textContent: "Hello world",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: false,
      canMove: true,
      canResize: true,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
    },
    ...overrides,
  };
}

const PICKER_SELECTION: HyperframePickerElementInfo = {
  id: "headline-1",
  tagName: "div",
  selector: "#headline-1",
  label: "Headline",
  boundingBox: { x: 10, y: 20, width: 300, height: 40 },
  textContent: "Hello world",
  src: null,
  dataAttributes: {},
};

describe("buildElementAgentPrompt", () => {
  it("produces the documented v1 schema", () => {
    const prompt = buildElementAgentPrompt({
      selection: makeSelection(),
      currentTime: 1.5,
      userInstruction: "Make this bigger",
    });
    expect(prompt).toBe(
      [
        "## HyperFrames element edit request v1",
        "Schema version: 1",
        "",
        "Make this bigger",
        "",
        "Composition: hero.html",
        "Playback time: 00:01",
        "Source file: hero.html",
        "DOM id: headline-1",
        "Selector: #headline-1",
        "Selector index: 0",
        "Tag: <div>",
        "Bounds: x=10, y=20, width=300, height=40",
        "Text: Hello world",
        "",
        "Guardrails:",
        "- Make a targeted change to this element only.",
        "- Preserve the rest of the composition and its timing.",
        "- Do not modify other elements' data-* attributes or positioning.",
        "- Prefer existing inline styles or existing CSS rules for this element over adding unrelated selectors.",
      ].join("\n"),
    );
  });

  it("includes text fields, inline styles, computed styles and a target snippet when present", () => {
    const prompt = buildElementAgentPrompt({
      selection: makeSelection({
        inlineStyles: { color: "red" },
        computedStyles: { "font-size": "16px" },
        textFields: [
          {
            key: "title",
            label: "Title",
            value: "Hello",
            tagName: "h1",
            attributes: [],
            inlineStyles: {},
            computedStyles: {},
            source: "self",
          },
        ],
      }),
      currentTime: 0,
      tagSnippet: "<div id='headline-1'>Hello world</div>",
      selectionContext: "Nested inside the hero card",
    });
    expect(prompt).toContain("Selection context:\nNested inside the hero card");
    expect(prompt).toContain('Text fields:\n- key=title; tag=<h1>; source=self; text="Hello"');
    expect(prompt).toContain("Inline styles:\ncolor: red");
    expect(prompt).toContain("Computed styles (browser-resolved):\nfont-size: 16px");
    expect(prompt).toContain("Target HTML:\n<div id='headline-1'>Hello world</div>");
  });
});

describe("buildAgentContextPreview", () => {
  it("summarizes composition, source, selector, tag and text", () => {
    expect(buildAgentContextPreview(makeSelection(), "hero.html")).toBe(
      [
        "Composition: hero.html",
        "Source: hero.html",
        "Selector: #headline-1  Tag: <div>",
        "Text: Hello world",
      ].join("\n"),
    );
  });
});

describe("buildPickerAgentPrompt", () => {
  it("produces a plain comment prompt when nothing is selected", () => {
    const prompt = buildPickerAgentPrompt({ selection: null, userInstruction: "Add a border" });
    expect(prompt).toBe(
      ["## HyperFrames element edit request v1", "Schema version: 1", "", "Add a border"].join(
        "\n",
      ),
    );
  });

  it("produces identical shared-field text to buildElementAgentPrompt for equivalent input", () => {
    const domPrompt = buildElementAgentPrompt({
      selection: makeSelection({ compositionPath: "", sourceFile: "" }),
      currentTime: 0,
    });
    const pickerPrompt = buildPickerAgentPrompt({ selection: PICKER_SELECTION });

    const sharedFields = [
      "DOM id: headline-1",
      "Selector: #headline-1",
      "Tag: <div>",
      "Bounds: x=10, y=20, width=300, height=40",
      "Text: Hello world",
    ];
    for (const line of sharedFields) {
      expect(domPrompt).toContain(line);
      expect(pickerPrompt).toContain(line);
    }
    // Both end on the identical guardrails block, byte for byte.
    const guardrails = [
      "Guardrails:",
      "- Make a targeted change to this element only.",
      "- Preserve the rest of the composition and its timing.",
      "- Do not modify other elements' data-* attributes or positioning.",
      "- Prefer existing inline styles or existing CSS rules for this element over adding unrelated selectors.",
    ].join("\n");
    expect(domPrompt.endsWith(guardrails)).toBe(true);
    expect(pickerPrompt.endsWith(guardrails)).toBe(true);
  });
});

describe("buildPickerAgentContextPreview", () => {
  it("returns an empty string when nothing is selected", () => {
    expect(buildPickerAgentContextPreview(null)).toBe("");
  });

  it("matches buildAgentContextPreview's selector/tag/text line format", () => {
    expect(buildPickerAgentContextPreview(PICKER_SELECTION)).toBe(
      ["Selector: #headline-1  Tag: <div>", "Text: Hello world"].join("\n"),
    );
  });
});

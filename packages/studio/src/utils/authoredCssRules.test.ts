import { describe, expect, it } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import {
  denormalizeAuthoredCssRuleText,
  findAuthoredCssRulesInHtml,
  findFirstAuthoredCssRuleInHtml,
  getAuthoredCssSelectorCandidates,
  measureAuthoredCssRuleContinuationIndent,
  normalizeAuthoredCssRuleText,
  replaceAuthoredCssRuleText,
} from "./authoredCssRules";

function makeSelection(id: string, classes: string[]): DomEditSelection {
  const element = {
    id,
    classList: {
      [Symbol.iterator]: function* () {
        yield* classes;
      },
    },
  } as unknown as HTMLElement;
  return {
    element,
    label: "Layer",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canEditText: false,
      canResize: true,
      canMove: true,
      canRotate: true,
      canDelete: true,
    },
    id: id || undefined,
    selector: undefined,
    selectorIndex: undefined,
  };
}

describe("authoredCssRules", () => {
  it("builds exact id and class candidates from the selected layer", () => {
    const selection = makeSelection("hero.main", ["stage", "hero", "card"]);
    expect(getAuthoredCssSelectorCandidates(selection)).toEqual([
      "#hero\\.main",
      ".stage",
      ".hero",
      ".card",
    ]);
  });

  it("finds the earliest exact rule across supported selectors", () => {
    const html = `
      <style>
        .other { color: gray; }
        .stage, .hero { color: red; padding: 12px; }
        .stage, .hero { color: blue; }
        #hero { color: green; }
      </style>
    `;

    const match = findFirstAuthoredCssRuleInHtml(html, ["#hero", ".stage"]);

    expect(match?.selectorText).toBe(".stage, .hero");
    expect(match?.ruleText).toContain(".stage, .hero");
    expect(match?.ruleText).toContain("color: red;");
    expect(match?.ruleText).toContain("padding: 12px;");
  });

  it("returns all matched rules in source order, including contextual selectors", () => {
    const html = `
      <style>
        .stage { color: red; }
        .other { color: gray; }
        .scene .stage { color: blue; }
        .stage, .hero { padding: 12px; }
      </style>
    `;

    const matches = findAuthoredCssRulesInHtml(html, [".stage"]);

    expect(matches.map((match) => match.selectorText)).toEqual([
      ".stage",
      ".scene .stage",
      ".stage, .hero",
    ]);
  });

  it("matches contextual selectors that target the selected class", () => {
    const html = `
      <style>
        #scene-10-scale .scale-input-left {
          left: 636px;
          top: 746px;
          width: 286px;
        }
      </style>
    `;

    const matches = findAuthoredCssRulesInHtml(html, [".scale-input-left"]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.selectorText).toBe("#scene-10-scale .scale-input-left");
  });

  it("replaces the whole matched rule text", () => {
    const html = `
      <style>
        .stage, .hero {
          color: red;
        }
        .hero {
          color: blue;
        }
      </style>
    `;

    const match = findFirstAuthoredCssRuleInHtml(html, [".stage"]);
    expect(match).not.toBeNull();

    const nextHtml = replaceAuthoredCssRuleText(
      html,
      match!,
      `.stage, .hero {\n          color: orange;\n          padding: 20px;\n        }`,
    );

    expect(nextHtml).toContain(
      ".stage, .hero {\n          color: orange;\n          padding: 20px;\n        }",
    );
    expect(nextHtml).toContain(".hero {\n          color: blue;\n        }");
  });

  it("normalizes and restores continuation indent for editor readability", () => {
    const html = `
      <style>
            .hook-line {
                position: absolute;
                left: 0;
            }
      </style>
    `;

    const match = findFirstAuthoredCssRuleInHtml(html, [".hook-line"]);
    expect(match).not.toBeNull();

    const displayText = normalizeAuthoredCssRuleText(match!);
    expect(displayText).toBe(".hook-line {\n    position: absolute;\n    left: 0;\n}");

    const restoredText = denormalizeAuthoredCssRuleText(displayText, match!);
    expect(restoredText).toBe(
      ".hook-line {\n                position: absolute;\n                left: 0;\n            }",
    );
  });

  it("does not duplicate the base indent when the editor text already contains it", () => {
    const rawRuleText =
      ".hook-line {\n                position: absolute;\n                left: 0;\n            }";
    const continuationIndent = measureAuthoredCssRuleContinuationIndent(rawRuleText);

    const restoredText = denormalizeAuthoredCssRuleText(rawRuleText, {
      selectorText: ".hook-line",
      ruleText: rawRuleText,
      start: 0,
      end: rawRuleText.length,
      sourceStart: 0,
      continuationIndent,
    });

    expect(restoredText).toBe(rawRuleText);
  });
});

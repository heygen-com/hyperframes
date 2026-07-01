/**
 * @vitest-environment node
 *
 * htmlParser.ts's null-`documentElement` guards, exercised against
 * **linkedom's** `DOMParser` — the implementation the CLI actually polyfills
 * onto `globalThis` in production (see `packages/cli/src/utils/dom.ts`,
 * `ensureDOMParser`). The rest of htmlParser.test.ts runs under
 * `@vitest-environment jsdom`, whose spec-compliant `DOMParser` always
 * synthesizes a full `<html><head><body>` document — even for `""` or
 * non-HTML text — so `documentElement` is never null there and the guards
 * added in this file can't be exercised under jsdom at all. linkedom
 * deviates from spec on exactly this point (confirmed directly against the
 * installed package): `parseFromString("", ...)` and
 * `parseFromString("just some text", ...)` both return a document with
 * `documentElement === null`. That's the actual, live crash path in the CLI
 * (`hyperframes info`, `hyperframes inspect`, Studio's edit endpoints, etc.)
 * this test suite reproduces and guards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOMParser as LinkedomDOMParser } from "linkedom";
import {
  CompositionHtmlParseError,
  parseHtml,
  updateElementInHtml,
  addElementToHtml,
  removeElementFromHtml,
  validateCompositionHtml,
  extractCompositionMetadata,
} from "./htmlParser.js";

const originalDOMParser = (globalThis as Record<string, unknown>).DOMParser;

beforeAll(() => {
  (globalThis as Record<string, unknown>).DOMParser = LinkedomDOMParser;
});

afterAll(() => {
  (globalThis as Record<string, unknown>).DOMParser = originalDOMParser;
});

const EMPTY_INPUTS = ["", "   \n\t  ", "just some plain text, no tags at all"];

describe("htmlParser.ts null-documentElement guards (linkedom, matches CLI runtime)", () => {
  it.each(EMPTY_INPUTS)("parseHtml throws CompositionHtmlParseError for %j", (html) => {
    expect(() => parseHtml(html)).toThrow(CompositionHtmlParseError);
    expect(() => parseHtml(html)).toThrow(/empty or could not be parsed/);
  });

  it.each(EMPTY_INPUTS)(
    "updateElementInHtml returns the input unchanged when the target id isn't found (never reaches documentElement)",
    (html) => {
      // getElementById/queryByAttr both miss on a documentElement-less doc, so
      // this hits the existing `if (!el) return html;` early return before
      // ever touching documentElement — same safe behavior as "id not found"
      // on a normal document. No guard needed on this path; asserted here so
      // a future refactor that removes the early return doesn't regress into
      // the null-deref crash.
      expect(updateElementInHtml(html, "some-id", { name: "x" })).toBe(html);
    },
  );

  it.each(EMPTY_INPUTS)("addElementToHtml throws CompositionHtmlParseError for %j", (html) => {
    expect(() =>
      addElementToHtml(html, {
        type: "text",
        name: "Title",
        startTime: 0,
        duration: 5,
        zIndex: 0,
      } as never),
    ).toThrow(CompositionHtmlParseError);
  });

  it.each(EMPTY_INPUTS)("removeElementFromHtml throws CompositionHtmlParseError for %j", (html) => {
    expect(() => removeElementFromHtml(html, "some-id")).toThrow(CompositionHtmlParseError);
  });

  it.each(EMPTY_INPUTS)(
    "extractCompositionMetadata throws CompositionHtmlParseError for %j",
    (html) => {
      expect(() => extractCompositionMetadata(html)).toThrow(CompositionHtmlParseError);
    },
  );

  it.each(EMPTY_INPUTS)(
    "validateCompositionHtml returns a typed failure (not a throw) for %j",
    (html) => {
      const result = validateCompositionHtml(html);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/empty or could not be parsed/);
    },
  );

  it("happy path: parseHtml succeeds against linkedom for well-formed HTML", () => {
    const html = `<!doctype html><html><body>
      <div id="stage">
        <div id="text1" data-start="0" data-end="5" data-name="Title"><div>Hello</div></div>
      </div>
    </body></html>`;
    const result = parseHtml(html);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.name).toBe("Title");
  });
});

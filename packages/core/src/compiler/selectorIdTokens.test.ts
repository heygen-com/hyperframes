import { describe, expect, it } from "vitest";
import {
  decodeCssIdentifierAt,
  escapeCssAttributeValue,
  escapeCssIdentifier,
  replaceSelectorAttributeTokens,
  replaceSelectorIdTokens,
} from "./selectorIdTokens";

describe("decodeCssIdentifierAt", () => {
  it("reads a plain identifier and stops at the first non-name character", () => {
    expect(decodeCssIdentifierAt("clip rect", 0)).toEqual({ value: "clip", end: 4 });
    expect(decodeCssIdentifierAt("#clip2.x", 1)).toEqual({ value: "clip2", end: 6 });
    expect(decodeCssIdentifierAt("#", 1)).toBeNull();
    expect(decodeCssIdentifierAt("# a", 1)).toBeNull();
  });

  it("decodes character and hex escapes, consuming one trailing whitespace after hex", () => {
    expect(decodeCssIdentifierAt(String.raw`fx\.1`, 0)).toEqual({ value: "fx.1", end: 5 });
    expect(decodeCssIdentifierAt(String.raw`fx\2e\31 {`, 0)).toEqual({ value: "fx.1", end: 9 });
    expect(decodeCssIdentifierAt("fx\\2e\\31\r\n{", 0)).toEqual({ value: "fx.1", end: 10 });
    expect(decodeCssIdentifierAt(String.raw`\31 st`, 0)).toEqual({ value: "1st", end: 6 });
  });

  it("rejects CSS newline escapes in identifiers", () => {
    for (const newline of ["\n", "\r", "\f", "\r\n"]) {
      expect(decodeCssIdentifierAt("\\" + newline, 0)).toBeNull();
    }
  });

  it("maps out-of-range and surrogate code points to U+FFFD", () => {
    expect(decodeCssIdentifierAt(String.raw`a\0 b`, 0)?.value).toBe("a�b");
    expect(decodeCssIdentifierAt(String.raw`a\d800 b`, 0)?.value).toBe("a�b");
    expect(decodeCssIdentifierAt(String.raw`a\110000 b`, 0)?.value).toBe("a�b");
  });

  it("accepts non-ASCII name characters unescaped", () => {
    expect(decodeCssIdentifierAt("héllo.x", 0)).toEqual({ value: "héllo", end: 5 });
  });
});

describe("escapeCssIdentifier", () => {
  it("follows the CSS.escape algorithm", () => {
    expect(escapeCssIdentifier("clip")).toBe("clip");
    expect(escapeCssIdentifier("fx.1")).toBe(String.raw`fx\.1`);
    expect(escapeCssIdentifier("a b")).toBe(String.raw`a\ b`);
    expect(escapeCssIdentifier("1st")).toBe(String.raw`\31 st`);
    expect(escapeCssIdentifier("-1")).toBe(String.raw`-\31 `);
    expect(escapeCssIdentifier("-")).toBe(String.raw`\-`);
    expect(escapeCssIdentifier("a\u0000b")).toBe("a�b");
    expect(escapeCssIdentifier("ab")).toBe(String.raw`a\1 b`);
    expect(escapeCssIdentifier("héllo")).toBe("héllo");
  });

  it("round-trips through decodeCssIdentifierAt", () => {
    for (const id of ["clip", "fx.1", "1st", "-1", "a b", "x:y", "tab\there", "ünï", "-"]) {
      const escaped = escapeCssIdentifier(id);
      expect(decodeCssIdentifierAt(escaped, 0)).toEqual({ value: id, end: escaped.length });
    }
  });
});

describe("replaceSelectorIdTokens", () => {
  const swap = (selector: string, ids: string[]) =>
    replaceSelectorIdTokens(selector, ids, (id) => `<${id}>`);

  it("replaces whole-token ids only", () => {
    expect(swap("#clip rect, #clip2 > #clip.x", ["clip"])).toBe("<clip> rect, #clip2 > <clip>.x");
  });

  it("matches escaped spellings of a raw id", () => {
    expect(swap(String.raw`#fx\.1 .a`, ["fx.1"])).toBe("<fx.1> .a");
    expect(swap(String.raw`#fx\2e\31  .a`, ["fx.1"])).toBe("<fx.1> .a");
  });

  it("skips ids inside strings and attribute selectors", () => {
    const selector = `[href="#clip"] #clip a[data-x='#clip'], [data-y=#clip]`;
    expect(swap(selector, ["clip"])).toBe(
      `[href="#clip"] <clip> a[data-x='#clip'], [data-y=#clip]`,
    );
  });

  it("does not treat a longer identifier as a shorter candidate", () => {
    expect(swap("#clip-b", ["clip"])).toBe("#clip-b");
    expect(swap("#clipé", ["clip"])).toBe("#clipé");
    expect(swap(String.raw`#clip\:x`, ["clip"])).toBe(String.raw`#clip\:x`);
  });
});

it("does not rewrite escaped hashes inside class names", () => {
  expect(replaceSelectorIdTokens(String.raw`.foo\#clip #clip`, ["clip"], () => "#new")).toBe(
    String.raw`.foo\#clip #new`,
  );
  expect(replaceSelectorIdTokens(String.raw`.foo\[bar #clip`, ["clip"], () => "#new")).toBe(
    String.raw`.foo\[bar #new`,
  );
});

it("serializes control characters inside CSS attribute string values", () => {
  expect(escapeCssAttributeValue('a\nb\rc\fd"e\\f')).toBe('a\\a b\\d c\\c d\\"e\\\\f');
});

it("keeps escaped closing brackets inside unquoted attribute tokens", () => {
  expect(
    replaceSelectorAttributeTokens(String.raw`use[href=\#sym\]bol]`, () => '[href="#renamed"]'),
  ).toBe('use[href="#renamed"]');
});

it("keeps commented brackets bounded when the closing bracket is missing", () => {
  const selector = "[" + "/*x*/".repeat(2000);
  expect(replaceSelectorAttributeTokens(selector, () => "changed")).toBe(selector);
});

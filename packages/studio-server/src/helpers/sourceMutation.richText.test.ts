import { describe, expect, it } from "vitest";
import { patchElementInHtml } from "./sourceMutation.js";

/**
 * The `rich-text` operation is the only one that can write markup into a
 * composition, so it is also the only place a patch payload can carry
 * something dangerous all the way to a file. These are the tests for that
 * boundary, and for the promise that the older text operation did not quietly
 * become a markup sink alongside it.
 */

const DOC = (inner: string) =>
  `<!doctype html><html><body><div data-composition-id="main"><h1 id="title">${inner}</h1></div></body></html>`;

function patchTitle(inner: string, value: string, type: "rich-text" | "text-content") {
  return patchElementInHtml(DOC(inner), { id: "title" }, [{ type, property: "", value }]);
}

describe("rich-text patch operation", () => {
  it("writes allowed formatting into the source", () => {
    const { html, matched } = patchTitle(
      "hello world",
      'hell<span style="color: red">o</span> world',
      "rich-text",
    );

    expect(matched).toBe(true);
    // The id is minted here so the bytes Studio records match the bytes on
    // disk — see stampNewChildIds.
    expect(html).toMatch(/<span data-hf-id="hf-[^"]+" style="color: red">o<\/span>/);
  });

  it("keeps the words and drops the script when the payload is hostile", () => {
    const { html } = patchTitle("safe", "<script>alert(1)</script>still<b>here</b>", "rich-text");

    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
    expect(html).toContain("still");
    expect(html).toMatch(/<b data-hf-id="hf-[^"]+">here<\/b>/);
  });

  it("strips an event handler smuggled onto an allowed tag", () => {
    const { html } = patchTitle("safe", '<span onclick="steal()">x</span>', "rich-text");

    expect(html).not.toContain("onclick");
    expect(html).toContain("x");
  });

  it("keeps only the allowlisted style properties", () => {
    const { html } = patchTitle(
      "safe",
      '<span style="color: red; position: fixed">x</span>',
      "rich-text",
    );

    expect(html).toContain("color: red");
    expect(html).not.toContain("position: fixed");
  });

  it("unwraps a structural tag rather than losing the text inside it", () => {
    const { html } = patchTitle("safe", "<div>kept</div>", "rich-text");

    expect(html).toContain("kept");
    expect(html).not.toContain("<div>kept");
  });

  it("replaces the previous contents rather than appending to them", () => {
    const { html } = patchTitle("old words", "new words", "rich-text");

    expect(html).toContain("new words");
    expect(html).not.toContain("old words");
  });

  it("reports unmatched for an element that is not there", () => {
    const result = patchElementInHtml(DOC("x"), { id: "absent" }, [
      { type: "rich-text", property: "", value: "<b>y</b>" },
    ]);

    expect(result.matched).toBe(false);
  });

  it("leaves the source alone when the value is null", () => {
    const before = DOC("keep me");
    const { html } = patchElementInHtml(before, { id: "title" }, [
      { type: "rich-text", property: "", value: null },
    ]);

    expect(html).toContain("keep me");
  });
});

describe("text-content is still not a markup sink", () => {
  it("escapes markup handed to the older operation, exactly as before", () => {
    const { html } = patchTitle("safe", '<span style="color: red">x</span>', "text-content");

    expect(html).not.toContain('<span style="color: red">');
    expect(html).toContain("&lt;span");
  });
});

describe("rich-text round trips what a real composition contains", () => {
  it("keeps text that looks like markup as text", () => {
    const { html } = patchTitle("safe", "a &lt;b&gt; &amp; c", "rich-text");

    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("keeps non-ASCII text intact", () => {
    const { html } = patchTitle("safe", "héllo 👍 世界", "rich-text");

    expect(html).toContain("héllo");
    expect(html).toContain("👍");
    expect(html).toContain("世界");
  });

  it("keeps a line break", () => {
    const { html } = patchTitle("safe", "a<br>b", "rich-text");

    expect(html).toMatch(/<br data-hf-id="hf-[^"]+">/);
  });

  it("keeps the wrapper span a flex element needs", () => {
    const { html } = patchTitle(
      "safe",
      '<span>a <span style="color: red">b</span> c</span>',
      "rich-text",
    );

    expect(html).toMatch(
      /<span data-hf-id="hf-[^"]+">a <span data-hf-id="hf-[^"]+" style="color: red">b<\/span> c<\/span>/,
    );
  });

  it("empties the element when every character was deleted", () => {
    const { html } = patchTitle("gone", "", "rich-text");

    expect(html).toContain('id="title"></h1>');
  });

  it("does not accumulate markup when the same value is written twice", () => {
    const value = '<span style="color: red">x</span>';
    const once = patchTitle("safe", value, "rich-text").html;
    const twice = patchElementInHtml(once, { id: "title" }, [
      { type: "rich-text", property: "", value },
    ]).html;

    expect(twice).toBe(once);
  });
});

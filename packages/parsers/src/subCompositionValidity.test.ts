import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { checkSubCompositionUsability, type ParsableDocumentLike } from "./subCompositionValidity";

function parse(html: string): ParsableDocumentLike {
  return parseHTML(html).document as unknown as ParsableDocumentLike;
}

const VALID_HTML = `<template id="intro-template">
  <div id="intro" data-composition-id="intro" data-width="1920" data-height="1080">
    <div class="title">HELLO WORLD</div>
  </div>
</template>`;

const VALID_HTML_NO_TEMPLATE = `<!doctype html>
<html>
<head></head>
<body>
  <div data-composition-id="intro" data-width="1920" data-height="1080">
    <div class="title">HELLO WORLD</div>
  </div>
</body>
</html>`;

describe("checkSubCompositionUsability", () => {
  it("accepts a valid <template>-based sub-composition", () => {
    expect(checkSubCompositionUsability(VALID_HTML, parse)).toEqual({ ok: true });
  });

  it("accepts a valid full-document sub-composition with no <template>", () => {
    expect(checkSubCompositionUsability(VALID_HTML_NO_TEMPLATE, parse)).toEqual({ ok: true });
  });

  it("rejects an empty string without ever calling parseHtml (avoids the linkedom null-deref crash)", () => {
    let parseCalled = false;
    const spyParse = (html: string): ParsableDocumentLike => {
      parseCalled = true;
      return parse(html);
    };
    const result = checkSubCompositionUsability("", spyParse);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty");
    expect(parseCalled).toBe(false);
  });

  it("rejects whitespace-only content", () => {
    const result = checkSubCompositionUsability("   \n\t  ", parse);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty");
  });

  it("rejects null/undefined (file could not be read)", () => {
    expect(checkSubCompositionUsability(null, parse).ok).toBe(false);
    expect(checkSubCompositionUsability(undefined, parse).ok).toBe(false);
  });

  it("rejects a valid-but-empty document (parses fine, no body content)", () => {
    const result = checkSubCompositionUsability(
      "<!doctype html><html><head></head><body></body></html>",
      parse,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-content");
  });

  it("rejects plain text with no tags — this is the exact input that crashes linkedom's Document.head getter", () => {
    // linkedom's parseHTML("just some text") returns documentElement === null.
    // Any caller that touches .head/.body on that document (as linkedom's own
    // internals do) throws "Cannot destructure property 'firstElementChild'
    // of 'documentElement' as it is null." checkSubCompositionUsability must
    // detect this from `documentElement` alone, before touching .head/.body.
    const result = checkSubCompositionUsability("just some plain text, no tags at all", parse);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unparsable");
  });

  it("rejects a <template> with only whitespace content", () => {
    const result = checkSubCompositionUsability("<template>   \n  </template>", parse);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-content");
  });

  it("rejects non-empty, parseable HTML with no data-composition-id anywhere (e.g. an AI-authored placeholder scene)", () => {
    const result = checkSubCompositionUsability(
      "<!doctype html><html><head></head><body><p>TODO: scene content</p></body></html>",
      parse,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-composition-root");
  });

  it("rejects a <template> with content but no data-composition-id element inside", () => {
    const result = checkSubCompositionUsability(
      '<template><div class="title">HELLO WORLD</div></template>',
      parse,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-composition-root");
  });
});

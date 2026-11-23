import { beforeEach, describe, expect, it, vi } from "vitest";

const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("linkedom", async (actual) => {
  const real = await actual<typeof import("linkedom")>();
  return {
    ...real,
    parseHTML: (...args: Parameters<typeof real.parseHTML>) => {
      parses.count += 1;
      return real.parseHTML(...args);
    },
  };
});

const { ensureHfIds } = await import("./hfIds.js");

const page = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

describe("ensureHfIds on a document whose elements all carry their ids", () => {
  beforeEach(() => {
    parses.count = 0;
  });

  it("returns it as it is, without a parse: a stamped bundle has nothing to mint", () => {
    const html = page(
      `<div data-hf-id="hf-a1b2"><svg data-hf-id="hf-c3d4"><path data-hf-id="hf-e5f6" d="M0 0"/></svg>` +
        `<script>var a = "<p>";</script></div>`,
    );
    expect(ensureHfIds(html)).toBe(html);
    expect(parses.count).toBe(0);
  });

  it("parses once when one element lacks its id, or has an empty one", () => {
    const missing = page(`<div data-hf-id="hf-a1b2"><p>hi</p></div>`);
    expect(ensureHfIds(missing)).toMatch(/<p data-hf-id="hf-[0-9a-z]+">hi<\/p>/);
    expect(parses.count).toBe(1);
    expect(ensureHfIds(page(`<div data-hf-id="">x</div>`))).toMatch(/data-hf-id="hf-[0-9a-z]+"/);
    expect(parses.count).toBe(2);
  });

  it("parses a stamped page not opening <head> then <body>: callers re-parsing the output expect both", () => {
    const headless = `<!DOCTYPE html><html><body><div data-hf-id="hf-a1b2">x</div></body></html>`;
    expect(ensureHfIds(headless)).toContain("<head></head><body>");
    const shapes = [
      `<html><head><title>t</title><body><p data-hf-id="hf-a1b2">x</p></body></html>`,
      `<html><head><div data-hf-id="hf-c3d4">x</div></head><body><p data-hf-id="hf-a1b2">x</p></body></html>`,
      `<html><head></head></html>`,
      `<html><head><title>t</title><!-- </head> --><body><p data-hf-id="hf-a1b2">x</p></body></html>`,
    ];
    for (const html of shapes) ensureHfIds(html);
    expect(parses.count).toBe(1 + shapes.length);
  });

  it("checks a fragment from its first tag, so elements before a stray <body> still get their ids", () => {
    const minted = ensureHfIds(`<p>y</p><body><div data-hf-id="hf-a1b2">x</div>`);
    expect(minted).toMatch(/<p data-hf-id="hf-[0-9a-z]+">y<\/p>/);
    expect(parses.count).toBe(1);
  });

  it("reads an id only from the tag's own attributes, never from a quoted value", () => {
    const html = page(`<div title='data-hf-id="hf-zzzz"'>x</div>`);
    expect(ensureHfIds(html)).toMatch(/<div data-hf-id="hf-[0-9a-z]+" title=/);
    expect(parses.count).toBe(1);
  });
});

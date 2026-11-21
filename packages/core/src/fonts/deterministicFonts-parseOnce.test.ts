import { beforeEach, describe, expect, it, vi } from "vitest";

const parses = vi.hoisted(() => ({ count: 0 }));

vi.mock("linkedom", async (importOriginal) => {
  const original = await importOriginal<typeof import("linkedom")>();
  return {
    ...original,
    parseHTML: (...args: Parameters<typeof original.parseHTML>) => {
      parses.count += 1;
      return original.parseHTML(...args);
    },
  };
});

import {
  injectDeterministicFontFaces,
  normalizeSystemFontPrimaryFamilies,
} from "./deterministicFonts.js";

const page = (note: string, family: string) =>
  `<!doctype html><html><head><style>.a{font-family:${family}}</style></head><body><!-- ${note} --><p class="a">Hello</p></body></html>`;

const offline = () => Promise.reject(new Error("offline"));

describe("the font step parses the page once", () => {
  beforeEach(() => {
    parses.count = 0;
  });

  it("builds the page's tree once for normalizing and once for injecting", async () => {
    const html = page("both steps", "-apple-system, Inter");
    const normalized = normalizeSystemFontPrimaryFamilies(html);
    expect(parses.count).toBe(1);
    parses.count = 0;
    const injected = await injectDeterministicFontFaces(normalized, { fetchImpl: offline });
    expect(parses.count).toBe(1);
    expect(injected).toContain("data-hyperframes-deterministic-fonts");
  });

  it("reads a page that needs no normalizing once across both steps", async () => {
    const html = page("unchanged", "Inter");
    const same = normalizeSystemFontPrimaryFamilies(html);
    expect(same).toBe(html);
    const injected = await injectDeterministicFontFaces(same, { fetchImpl: offline });
    expect(parses.count).toBe(1);
    expect(injected).toContain("data-hyperframes-deterministic-fonts");
  });

  it("gives the same page the same output as when each step parses on its own", async () => {
    const html = page("same output", "-apple-system, Inter");
    const together = await injectDeterministicFontFaces(normalizeSystemFontPrimaryFamilies(html), {
      fetchImpl: offline,
    });
    // another page in between drops the shared tree, so the steps below parse for themselves
    await injectDeterministicFontFaces(page("other", "Inter"), { fetchImpl: offline });
    const normalized = normalizeSystemFontPrimaryFamilies(html);
    await injectDeterministicFontFaces(page("other again", "Inter"), { fetchImpl: offline });
    const apart = await injectDeterministicFontFaces(normalized, { fetchImpl: offline });
    expect(together).toBe(apart);
  });
});

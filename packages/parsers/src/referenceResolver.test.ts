import { describe, expect, it } from "vitest";
import { resolveReferencedStart, type RefResolverEl } from "./referenceResolver.js";

describe("resolveReferencedStart", () => {
  it("still resolves through an adapter that only implements getAttribute", () => {
    const element = (attrs: Record<string, string>): RefResolverEl => ({
      getAttribute: (name) => attrs[name] ?? null,
    });
    const intro = element({ id: "intro", "data-start": "1", "data-duration": "3" });
    const clip = element({ id: "clip", "data-start": "intro + 1" });
    const doc = {
      getElementById: (id: string) => (id === "intro" ? intro : null),
      querySelector: () => null,
    };
    expect(resolveReferencedStart(doc, clip, new Map(), new Set())).toBe(5);
  });
});

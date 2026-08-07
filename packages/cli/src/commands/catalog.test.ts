import { describe, expect, it } from "vitest";

import { pickByName } from "./catalog.js";

/** The whole registry, which is what "in this registry" has to be measured against. */
const registryNames = new Set(["fade-through", "whip-pan", "count-up"]);
const item = (name: string): { name: string } => ({ name });

describe("pickByName", () => {
  it("counts only the ranked names this registry has no item for", () => {
    const { ranked, missing } = pickByName(
      [item("fade-through"), item("whip-pan"), item("count-up")],
      ["whip-pan", "fade-through", "accordion", "alert-dialog"],
      registryNames,
    );

    expect(ranked.map((entry) => entry.name)).toEqual(["whip-pan", "fade-through"]);
    // accordion and alert-dialog are in the ranking artifact and nowhere in the
    // registry: a real skew between two separately published generations.
    expect(missing).toBe(2);
  });

  it("does not count moves the user's own filter removed", () => {
    // `items` is what survived --type/--tag; the registry still has the rest.
    const { ranked, missing } = pickByName(
      [item("fade-through")],
      ["whip-pan", "fade-through", "count-up", "accordion"],
      registryNames,
    );

    expect(ranked.map((entry) => entry.name)).toEqual(["fade-through"]);
    // whip-pan and count-up are installable, just filtered out. Only accordion
    // is genuinely absent, and filtering must not inflate that number.
    expect(missing).toBe(1);
  });

  it("reports nothing missing when the whole ranking is installable", () => {
    const { missing } = pickByName(
      [item("fade-through")],
      ["fade-through", "whip-pan"],
      registryNames,
    );

    expect(missing).toBe(0);
  });
});

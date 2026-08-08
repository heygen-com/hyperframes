import { beforeEach, describe, expect, it, vi } from "vitest";

import { countUnindexed, pickByName } from "./catalog.js";

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

describe("countUnindexed", () => {
  it("counts the registry moves the on-device index holds no vector for", () => {
    // The move published after the artifact was fetched. Meaning search cannot
    // rank it at all, which is the failure this number exists to expose.
    expect(countUnindexed(registryNames, ["fade-through"])).toBe(2);
  });

  it("reports nothing when the index covers the registry", () => {
    expect(countUnindexed(registryNames, ["count-up", "whip-pan", "fade-through"])).toBe(0);
  });

  it("does not let names the registry dropped paper over a gap", () => {
    // The artifact holds two names this registry cannot install and is missing
    // two it can. Comparing sizes rather than membership would call that even.
    expect(countUnindexed(registryNames, ["fade-through", "accordion", "alert-dialog"])).toBe(2);
  });
});

// ── The command envelope ────────────────────────────────────────────────────
// The JSON envelope is the surface an agent reads, so under-coverage and the
// score are pinned where they are actually published rather than only at the
// helper that computes them.

const state = vi.hoisted(() => ({
  registry: [] as Array<{ name: string; type: string }>,
  ranking: null as Array<{ name: string; score: number }> | null,
  indexed: [] as string[],
}));

vi.mock("../registry/resolver.js", () => ({
  listRegistryItems: async () => state.registry,
  loadAllItems: async (entries: Array<{ name: string; type: string }>) =>
    entries.map((entry) => ({
      name: entry.name,
      type: entry.type,
      title: entry.name,
      description: `${entry.name} description`,
      tags: [],
    })),
}));

vi.mock("../registry/localModel.js", () => ({
  // "ready" is a user who opted into the on-device tier at some point. Every
  // later search takes that tier with no flag, which is how a frozen artifact
  // goes on answering forever.
  localModelStatus: () => ({ status: "ready" }),
  localModelConsent: () => true,
  ensureLocalModel: async () => true,
  recordLocalModelConsent: () => {},
  downloadOfferMessage: () => "offer",
  nonInteractiveConsentMessage: () => "consent",
}));

vi.mock("../registry/localSemantic.js", () => ({
  localSemanticRanking: async () => state.ranking,
  localVectorNames: () => state.indexed,
  hasLocalVectors: () => true,
  fetchLocalVectors: async () => true,
}));

const block = (name: string): { name: string; type: string } => ({
  name,
  type: "hyperframes:block",
});
const component = (name: string): { name: string; type: string } => ({
  name,
  type: "hyperframes:component",
});

interface Envelope {
  tier: string;
  dropped: number;
  unindexed: number;
  top_score?: number;
  shown: number;
}

async function runCatalog(args: Record<string, unknown>): Promise<string> {
  const command = (await import("./catalog.js")).default as unknown as {
    run: (context: { args: Record<string, unknown> }) => Promise<void>;
  };
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  try {
    await command.run({ args });
  } finally {
    log.mockRestore();
  }
  // Colour is decoration; assertions are about the words. The escape byte is
  // built rather than written: as a literal or as \u001B it is a control
  // character in the source, which the lint rules reject either way.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return lines.join("\n").replace(ansi, "");
}

async function runEnvelope(args: Record<string, unknown>): Promise<Envelope> {
  return JSON.parse(await runCatalog({ json: true, ...args })) as Envelope;
}

beforeEach(() => {
  state.registry = [block("count-up"), block("fade-through"), component("whip-pan")];
  state.indexed = ["count-up", "fade-through", "whip-pan"];
  state.ranking = [
    { name: "count-up", score: 0.71 },
    { name: "whip-pan", score: 0.42 },
    { name: "fade-through", score: 0.31 },
  ];
});

describe("catalog --json meaning search", () => {
  it("reports the registry moves meaning search cannot see", async () => {
    // Published after the user's artifact was fetched: in the registry, absent
    // from the index, and therefore unreturnable by any query.
    state.registry.push(block("split-screen"));

    const envelope = await runEnvelope({ query: "make a number count up" });

    expect(envelope.tier).toBe("on-device");
    expect(envelope.unindexed).toBe(1);
  });

  it("reports nothing unindexed when the artifact matches the registry", async () => {
    const envelope = await runEnvelope({ query: "make a number count up" });

    expect(envelope.unindexed).toBe(0);
  });

  it("measures unindexed against the unfiltered registry under --type", async () => {
    // The missing move is a component; the user asked for blocks. Their filter
    // is not the index being stale, and it must not hide a stale index either.
    state.registry.push(component("push-in"));

    const envelope = await runEnvelope({ query: "make a number count up", type: "block" });

    expect(envelope.shown).toBe(2);
    expect(envelope.unindexed).toBe(1);
  });

  it("keeps dropped counted against the unfiltered registry under --type", async () => {
    // accordion is the only name the registry genuinely lacks. whip-pan is
    // installable and merely filtered out, so it is not a drop.
    state.ranking = [
      { name: "count-up", score: 0.71 },
      { name: "whip-pan", score: 0.62 },
      { name: "accordion", score: 0.55 },
      { name: "fade-through", score: 0.31 },
    ];

    const envelope = await runEnvelope({ query: "make a number count up", type: "block" });

    expect(envelope.dropped).toBe(1);
    expect(envelope.shown).toBe(2);
  });

  it("carries the score of the best result it actually showed", async () => {
    // The top-ranked name is not installable here, so reporting the ranking's
    // own head would describe a row the caller never received.
    state.ranking = [
      { name: "accordion", score: 0.93 },
      { name: "count-up", score: 0.71 },
      { name: "whip-pan", score: 0.42 },
      { name: "fade-through", score: 0.31 },
    ];

    const envelope = await runEnvelope({ query: "make a number count up" });

    expect(envelope.top_score).toBeCloseTo(0.71);
  });

  it("omits the score on the word tier, whose scale is not the same one", async () => {
    state.ranking = null;

    const envelope = await runEnvelope({ query: "count up" });

    expect(envelope.tier).toBe("words");
    expect(envelope.top_score).toBeUndefined();
    // Word matching ranks the live registry listing, so it is never stale.
    expect(envelope.unindexed).toBe(0);
  });
});

describe("catalog meaning search, on a terminal", () => {
  it("says how much is missing and what to run about it", async () => {
    state.registry.push(block("split-screen"));

    const output = await runCatalog({ query: "make a number count up" });

    expect(output).toContain("1 of 4 moves are missing from the on-device index");
    expect(output).toContain("Re-run with --on-device to refresh it.");
  });

  it("says nothing when the index covers the registry", async () => {
    const output = await runCatalog({ query: "make a number count up" });

    expect(output).not.toContain("missing from the on-device index");
  });
});

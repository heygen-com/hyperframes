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
  registry: [] as Array<{ name: string; type: string; tags?: string[] }>,
  artifactRevision: "revision-current",
  cachedVectorRevision: "revision-current",
  vectorFetches: 0,
  vectorFetchSucceeds: true,
  ranking: null as Array<{ name: string; score: number }> | null,
  rankingError: null as Error | null,
  indexed: [] as string[],
  // The consent path. Static stubs could not reach it: with the status pinned
  // to "ready" the prompt never fires, so the answer was never a variable and
  // the decline branch was never executed by any test.
  modelStatus: "ready" as "ready" | "not-asked" | "declined" | "unavailable",
  confirmAnswer: true as boolean,
  consentRecorded: [] as boolean[],
  downloads: 0,
  runtimeAvailable: true,
}));

vi.mock("../registry/resolver.js", () => ({
  loadAllItems: async (entries: Array<{ name: string; type: string; tags?: string[] }>) =>
    entries.map((entry) => ({
      name: entry.name,
      type: entry.type,
      title: entry.name,
      description: `${entry.name} description`,
      tags: entry.tags ?? [],
    })),
}));

vi.mock("../registry/remote.js", () => ({
  fetchRegistryManifest: async () => ({
    items: state.registry,
    catalogArtifact: { revision: state.artifactRevision },
  }),
}));

vi.mock("@clack/prompts", () => ({
  confirm: async () => state.confirmAnswer,
  isCancel: (value: unknown) => value === null,
}));

vi.mock("../registry/localModel.js", () => ({
  // "ready" is a user who opted into the on-device tier at some point. Every
  // later search takes that tier with no flag, which is how a frozen artifact
  // goes on answering forever. "not-asked" is the first run, the one that asks.
  // Recording an answer is what stops the CLI asking again, so the stub has to
  // move with it. Pinned to "not-asked" the second offer later in the run also
  // fires, and the double prompt looks like a product bug rather than a stub
  // that does not model the contract.
  localModelStatus: () => {
    const answer = state.consentRecorded.at(-1);
    return {
      status: answer === false ? "declined" : answer === true ? "ready" : state.modelStatus,
    };
  },
  ensureLocalModel: async () => {
    state.downloads += 1;
    if (state.modelStatus === "unavailable") state.modelStatus = "ready";
    return true;
  },
  recordLocalModelConsent: (enabled: boolean) => {
    state.consentRecorded.push(enabled);
  },
  downloadOfferMessage: () => "offer",
  nonInteractiveConsentMessage: () => "consent",
}));

vi.mock("../registry/localEmbedder.js", () => ({
  // The native runtime is present in these tests. Left unmocked it answers
  // false under vitest, and every accepted offer returns at the runtime guard
  // before it can download, which looks like the download being skipped.
  localRuntimeAvailable: async () => state.runtimeAvailable,
}));

vi.mock("../registry/localSemantic.js", () => ({
  localSemanticRanking: async () => {
    if (state.rankingError) throw state.rankingError;
    return state.ranking;
  },
  localVectorNames: () => state.indexed,
  cachedLocalVectorRevision: () => state.cachedVectorRevision,
  hasLocalVectors: () => true,
  fetchLocalVectors: async (_registry: string, options: { expectedRevision?: string } = {}) => {
    state.vectorFetches += 1;
    if (state.vectorFetchSucceeds && options.expectedRevision !== undefined) {
      state.cachedVectorRevision = options.expectedRevision;
    }
    return state.vectorFetchSucceeds;
  },
}));

const block = (name: string, tags?: string[]): { name: string; type: string; tags?: string[] } => ({
  name,
  type: "hyperframes:block",
  tags,
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
  warnings?: string[];
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
  state.modelStatus = "ready";
  state.artifactRevision = "revision-current";
  state.cachedVectorRevision = "revision-current";
  state.vectorFetches = 0;
  state.vectorFetchSucceeds = true;
  state.rankingError = null;
  state.confirmAnswer = true;
  state.consentRecorded = [];
  state.downloads = 0;
  state.runtimeAvailable = true;
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

  it("finds registry tags on the word tier", async () => {
    state.modelStatus = "declined";
    state.ranking = null;
    state.registry = [block("fade-through", ["transition"]), block("count-up", ["number"])];

    const envelope = await runEnvelope({ query: "transition" });

    expect(envelope.tier).toBe("words");
    expect(envelope.shown).toBe(1);
  });

  it("carries an on-device runtime failure into the JSON envelope", async () => {
    state.rankingError = new Error("model could not load");

    const envelope = await runEnvelope({ query: "count up" });

    expect(envelope.tier).toBe("words");
    expect(envelope.warnings).toEqual(["on-device search did not run: model could not load"]);
  });

  it("refreshes a changed vector revision under existing consent", async () => {
    state.cachedVectorRevision = "revision-previous";

    const envelope = await runEnvelope({ query: "count up" });

    expect(envelope.tier).toBe("on-device");
    expect(state.vectorFetches).toBe(1);
    expect(state.cachedVectorRevision).toBe("revision-current");
    expect(state.consentRecorded).toEqual([]);
  });

  it("replaces a changed model revision under existing consent", async () => {
    state.modelStatus = "unavailable";

    const envelope = await runEnvelope({ query: "count up" });

    expect(envelope.tier).toBe("on-device");
    expect(state.downloads).toBe(1);
    expect(state.consentRecorded).toEqual([]);
  });

  it("keeps the previous vectors and reports a failed routine refresh", async () => {
    state.cachedVectorRevision = "revision-previous";
    state.vectorFetchSucceeds = false;

    const envelope = await runEnvelope({ query: "count up" });

    expect(envelope.tier).toBe("on-device");
    expect(state.cachedVectorRevision).toBe("revision-previous");
    expect(envelope.warnings).toEqual([
      "on-device search is using the previous catalog vectors because the update failed",
    ]);
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

describe("the on-device download offer", () => {
  // The offer only exists for someone who can answer it. Off a terminal the
  // caller must add --yes explicitly, so a test that forgets the terminal
  // never reaches the prompt and passes for the wrong reason.
  const asATerminal = async (run: () => Promise<string>): Promise<string> => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      return await run();
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
      else delete (process.stdout as unknown as { isTTY?: boolean }).isTTY;
    }
  };

  it("downloads nothing and records no consent when the offer is declined", async () => {
    // The whole point of asking. Nothing below this line may fetch 32 MB.
    state.modelStatus = "not-asked";
    state.confirmAnswer = false;

    const output = await asATerminal(() =>
      runCatalog({ query: "make a number count up", "on-device": true }),
    );

    expect(state.downloads).toBe(0);
    expect(state.consentRecorded).toEqual([false]);
    expect(output).not.toContain("offer");
  });

  it("downloads once when the offer is accepted", async () => {
    state.modelStatus = "not-asked";
    state.confirmAnswer = true;

    await asATerminal(() => runCatalog({ query: "make a number count up", "on-device": true }));

    expect(state.downloads).toBe(1);
    expect(state.consentRecorded).toEqual([true]);
  });

  it("keeps a decline sticky until explicit --yes consent", async () => {
    state.modelStatus = "not-asked";
    state.confirmAnswer = false;

    await asATerminal(() => runCatalog({ query: "count up", "on-device": true }));
    state.confirmAnswer = true;
    await asATerminal(() => runCatalog({ query: "count up", "on-device": true }));

    expect(state.downloads).toBe(0);
    expect(state.consentRecorded).toEqual([false]);

    await asATerminal(() => runCatalog({ query: "count up", "on-device": true, yes: true }));
    expect(state.downloads).toBe(1);
    expect(state.consentRecorded).toEqual([false, true]);
  });

  it("does not treat non-interactive output as download consent", async () => {
    state.modelStatus = "not-asked";

    await runEnvelope({ query: "count up", "on-device": true });

    expect(state.downloads).toBe(0);
    expect(state.consentRecorded).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHarnessModels } from "./harnessModels";
import {
  clearModelCatalogCache,
  listAgentModels,
  modelCost,
  resolveDefaultEffort,
  resolveDefaultModel,
  withModelArgs,
} from "./agentModels";

const CATALOG = {
  anthropic: {
    models: {
      "claude-opus-4-6": {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        tool_call: true,
        cost: { input: 15, output: 75 },
        limit: { context: 200000 },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        tool_call: true,
        cost: { input: 1, output: 5 },
        reasoning_options: [{ type: "budget_tokens", min: 1024 }],
      },
      "claude-embed": { id: "claude-embed", name: "Embeddings", tool_call: false },
    },
  },
  openai: {
    models: {
      "gpt-5.6-luna": {
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        tool_call: true,
        cost: { input: 0.5, output: 2 },
        reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high"] }],
      },
    },
  },
};

/**
 * The harness is asked first in production, and it is a real CLI on the
 * machine — mocked here so these tests measure the catalog path itself rather
 * than whatever happens to be installed. The harness path has its own tests.
 */
vi.mock("./harnessModels", () => ({
  listHarnessModels: vi.fn(async () => null),
  clearHarnessModelCache: vi.fn(),
}));

const harnessModels = vi.mocked(listHarnessModels);

beforeEach(() => {
  harnessModels.mockResolvedValue(null);
});

afterEach(() => {
  clearModelCatalogCache();
  vi.unstubAllGlobals();
});

function stubCatalog(payload: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => payload } as Response));
}

describe("listAgentModels with a harness that can answer", () => {
  it("takes the list and the efforts from the harness, and only prices from the catalog", async () => {
    stubCatalog(CATALOG);
    harnessModels.mockResolvedValue([
      { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", effortOptions: ["low", "medium"] },
    ]);
    const [model] = await listAgentModels("codex");
    // The catalog says this model also takes "none"; the harness says it does
    // not, and the harness is the thing that has to run it.
    expect(model?.effortOptions).toEqual(["low", "medium"]);
    expect(model?.inputCost).toBe(0.5);
    expect(await resolveDefaultEffort("codex", "gpt-5.6-luna")).toBe("low");
  });

  it("never offers a model the harness left out, however good the catalog says it is", async () => {
    stubCatalog(CATALOG);
    harnessModels.mockResolvedValue([{ id: "gpt-5.6-sol", name: "GPT-5.6-Sol" }]);
    expect((await listAgentModels("codex")).map((model) => model.id)).toEqual(["gpt-5.6-sol"]);
  });

  it("falls back to the harness' own default only when nothing is priced", async () => {
    stubCatalog(CATALOG);
    harnessModels.mockResolvedValue([
      { id: "unpriced-a", name: "A" },
      { id: "unpriced-b", name: "B", isDefault: true },
    ]);
    expect(await resolveDefaultModel("codex")).toBe("unpriced-b");
  });
});

describe("listAgentModels", () => {
  it("lists tool-capable models for the harness's provider, cheapest first", async () => {
    stubCatalog(CATALOG);
    const models = await listAgentModels("claude");
    expect(models.map((model) => model.id)).toEqual(["claude-haiku-4-5", "claude-opus-4-6"]);
    // A model that cannot call tools cannot drive a coding agent.
    expect(models.some((model) => model.id === "claude-embed")).toBe(false);
    expect(models[1]?.contextWindow).toBe(200000);
  });

  it("has nothing to offer for provider-agnostic harnesses", async () => {
    stubCatalog(CATALOG);
    expect(await listAgentModels("hermes")).toEqual([]);
    expect(await listAgentModels("custom")).toEqual([]);
  });

  it("falls back to the harness default when the catalog is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await listAgentModels("claude")).toEqual([]);
    expect(await resolveDefaultModel("claude")).toBeNull();
  });

  it("reads the catalog once per window", async () => {
    stubCatalog(CATALOG);
    await listAgentModels("claude");
    await listAgentModels("codex");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("resolveDefaultModel", () => {
  it("is the cheapest model that can run", async () => {
    stubCatalog(CATALOG);
    expect(await resolveDefaultModel("claude")).toBe("claude-haiku-4-5");
  });
});

describe("modelCost", () => {
  it("weights input over output, since a run reads more than it writes", () => {
    expect(modelCost({ id: "a", name: "a", inputCost: 1, outputCost: 5 })).toBe(8);
    expect(modelCost({ id: "b", name: "b", inputCost: 3, outputCost: 15 })).toBe(24);
  });

  it("sorts unpriced models last instead of treating them as free", () => {
    expect(modelCost({ id: "c", name: "c" })).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("withModelArgs", () => {
  it("uses each harness's own flag", () => {
    expect(withModelArgs("claude", ["-p"], "claude-haiku-4-5")).toEqual([
      "-p",
      "--model",
      "claude-haiku-4-5",
    ]);
    expect(withModelArgs("openclaw", ["agent", "exec"], "x")).toEqual([
      "agent",
      "exec",
      "--model",
      "x",
    ]);
  });

  it("keeps the flag ahead of a trailing stdin marker", () => {
    expect(withModelArgs("codex", ["exec", "-"], "gpt-5.6-sol")).toEqual([
      "exec",
      "-m",
      "gpt-5.6-sol",
      "-",
    ]);
  });

  it("leaves args alone without a model, or for a harness with no flag", () => {
    expect(withModelArgs("claude", ["-p"])).toEqual(["-p"]);
    expect(withModelArgs("custom", ["--run"], "anything")).toEqual(["--run"]);
  });
});

describe("effort", () => {
  it("takes the levels from the catalog, never a list of our own", async () => {
    stubCatalog(CATALOG);
    const [luna] = await listAgentModels("codex");
    expect(luna?.effortOptions).toEqual(["none", "low", "medium", "high"]);

    // Anthropic reasons on a token budget, so there is no effort to offer.
    const [haiku] = await listAgentModels("claude");
    expect(haiku?.effortOptions).toBeUndefined();
  });

  it("defaults to the lowest level the model offers", async () => {
    stubCatalog(CATALOG);
    expect(await resolveDefaultEffort("codex")).toBe("none");
    // A harness with no effort flag carries none, whatever the catalog says.
    expect(await resolveDefaultEffort("claude")).toBeNull();
  });

  it("passes effort the way the harness takes it", () => {
    expect(withModelArgs("codex", ["exec", "-"], "gpt-5.6-luna", "low")).toEqual([
      "exec",
      "-m",
      "gpt-5.6-luna",
      "-c",
      'model_reasoning_effort="low"',
      "-",
    ]);
    // Claude Code has no effort flag: the model still lands, the effort does not.
    expect(withModelArgs("claude", ["-p"], "claude-haiku-4-5", "low")).toEqual([
      "-p",
      "--model",
      "claude-haiku-4-5",
    ]);
  });
});

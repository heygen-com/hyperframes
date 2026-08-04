import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearModelCatalogCache,
  listAgentModels,
  modelCost,
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
      },
      "claude-embed": { id: "claude-embed", name: "Embeddings", tool_call: false },
    },
  },
  openai: { models: {} },
};

afterEach(() => {
  clearModelCatalogCache();
  vi.unstubAllGlobals();
});

function stubCatalog(payload: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => payload } as Response));
}

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

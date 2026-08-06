import { describe, expect, it } from "vitest";
import { acpModelId, readAcpModels } from "./models";

function session(availableModels: unknown, currentModelId?: string) {
  return { sessionId: "s1", models: { availableModels, currentModelId } };
}

describe("readAcpModels", () => {
  it("keeps whatever the agent named, in the agent's own words", () => {
    expect(
      readAcpModels(
        session([
          { modelId: "sonnet", name: "Claude Sonnet" },
          { modelId: "opus", name: "Claude Opus" },
        ]),
      ),
    ).toEqual([
      { id: "sonnet", name: "Claude Sonnet", isDefault: false },
      { id: "opus", name: "Claude Opus", isDefault: false },
    ]);
  });

  // The Codex adapter ships one entry per model-and-level. Left flat, the same
  // model appears six times and the effort chip has nothing to do.
  it("folds the levels in an id into one model that offers them", () => {
    expect(
      readAcpModels(
        session(
          [
            { modelId: "gpt-5.6-sol[low]", name: "GPT-5.6-Sol (low)" },
            { modelId: "gpt-5.6-sol[high]", name: "GPT-5.6-Sol (high)" },
            { modelId: "gpt-5.6-terra[low]", name: "GPT-5.6-Terra (low)" },
          ],
          "gpt-5.6-sol[high]",
        ),
      ),
    ).toEqual([
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6-Sol",
        isDefault: true,
        effortOptions: ["low", "high"],
        defaultEffort: "high",
      },
      { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", isDefault: false, effortOptions: ["low"] },
    ]);
  });

  // One unreadable entry is not a reason to leave the picker empty.
  it("skips an entry it cannot read and keeps the rest", () => {
    expect(readAcpModels(session([{ name: "no id" }, "nonsense", { modelId: "opus" }]))).toEqual([
      { id: "opus", name: "opus", isDefault: false },
    ]);
  });

  // Null and empty are different answers: "ask the catalog" and "none".
  it("says nothing rather than nothing-known when the agent has no models", () => {
    expect(readAcpModels({ sessionId: "s1" })).toBeNull();
    expect(readAcpModels(session([]))).toBeNull();
    expect(readAcpModels(null)).toBeNull();
  });
});

describe("acpModelId", () => {
  // The level rides inside the id, which is also how it was read back out.
  it("puts the level back where the protocol carries it", () => {
    expect(acpModelId("gpt-5.6-sol", "high")).toBe("gpt-5.6-sol[high]");
    expect(acpModelId("sonnet")).toBe("sonnet");
    expect(acpModelId(undefined, "high")).toBeNull();
  });
});

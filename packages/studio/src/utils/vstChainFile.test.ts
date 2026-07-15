import { describe, expect, it } from "vitest";
import { parseChainFile, serializeChainFile, type ChainFileJson } from "./vstChainFile";

function sampleChain(): ChainFileJson {
  return {
    version: 1,
    plugins: [
      {
        format: "vst3",
        path: "/Library/Audio/Plug-Ins/VST3/Reverb.vst3",
        pluginName: "Reverb",
        name: "Reverb",
        stateB64: "AAECAw==",
      },
      {
        format: "builtin",
        path: "builtin://eq",
        pluginName: null,
        name: "EQ",
        stateB64: null,
      },
    ],
  };
}

describe("vstChainFile", () => {
  it("round-trips a chain through serializeChainFile + parseChainFile", () => {
    const chain = sampleChain();
    const parsed = parseChainFile(serializeChainFile(chain));
    expect(parsed).toEqual(chain);
  });

  it("returns null for malformed JSON", () => {
    expect(parseChainFile("not json")).toBeNull();
  });

  it("returns null for a missing/wrong version", () => {
    expect(parseChainFile(JSON.stringify({ version: 2, plugins: [] }))).toBeNull();
    expect(parseChainFile(JSON.stringify({ plugins: [] }))).toBeNull();
  });

  it("returns null when plugins is missing or contains malformed entries", () => {
    expect(parseChainFile(JSON.stringify({ version: 1 }))).toBeNull();
    expect(
      parseChainFile(
        JSON.stringify({
          version: 1,
          plugins: [
            { format: "not-a-format", path: "x", pluginName: null, name: "x", stateB64: null },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("parses an empty plugin chain", () => {
    expect(parseChainFile(JSON.stringify({ version: 1, plugins: [] }))).toEqual({
      version: 1,
      plugins: [],
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  appendCarveBands,
  parseChainFile,
  projectRelativeAssetPath,
  serializeChainFile,
  type ChainFileJson,
} from "./vstChainFile";

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

describe("appendCarveBands", () => {
  it("appends one PeakFilter per band, preserving existing plugins", () => {
    const existing: ChainFileJson = {
      version: 1,
      plugins: [
        { format: "builtin", path: "Reverb", pluginName: null, name: "Reverb", stateB64: null },
      ],
    };
    const next = appendCarveBands(existing, [
      { freq: 1000, gainDb: -4, q: 1.5 },
      { freq: 2500, gainDb: -2, q: 1.5 },
    ]);
    expect(next.plugins).toHaveLength(3);
    expect(next.plugins[0].path).toBe("Reverb"); // untouched
    expect(next.plugins[1].path).toBe("PeakFilter");
    const params = JSON.parse(atob(next.plugins[1].stateB64 ?? ""));
    expect(params).toEqual({ cutoff_frequency_hz: 1000, gain_db: -4, q: 1.5 });
    expect(existing.plugins).toHaveLength(1); // input not mutated
  });

  it("starts a fresh chain from null", () => {
    const next = appendCarveBands(null, [{ freq: 400, gainDb: -3, q: 1.5 }]);
    expect(next.version).toBe(1);
    expect(next.plugins).toHaveLength(1);
    expect(next.plugins[0].format).toBe("builtin");
    expect(next.plugins[0].pluginName).toBeNull();
  });
});

describe("projectRelativeAssetPath", () => {
  it("extracts the part after /preview/", () => {
    expect(projectRelativeAssetPath("http://x/preview/media/vo.wav?t=1")).toBe("media/vo.wav");
  });
  it("strips a leading ./ from an already-relative src", () => {
    expect(projectRelativeAssetPath("./media/vo.wav")).toBe("media/vo.wav");
  });
  it("returns null for empty input", () => {
    expect(projectRelativeAssetPath("")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { audioAttributeShapeError } from "@hyperframes/lint";
import { parseAutomation } from "./audioAutomation";
import { parseAudioFxChain } from "./audioFx";

const PARSERS = { "data-automation": parseAutomation, "data-fx-chain": parseAudioFxChain } as const;

const accepts = (attr: keyof typeof PARSERS, json: string) => {
  try {
    PARSERS[attr](json);
    return true;
  } catch {
    return false;
  }
};

describe("lint's audio attribute envelope matches the renderer's parsers", () => {
  it.each([
    [
      "data-automation",
      '{"version": 1, "lanes": [{"target": "volume", "points": [{"t": 0, "v": 1}]}]}',
    ],
    ["data-automation", '{"version": 1, "lanes": []}'],
    ["data-automation", '{"lanes": []}'],
    ["data-automation", '{"version": 2, "lanes": []}'],
    ["data-automation", '{"version": "1", "lanes": []}'],
    ["data-automation", "{version: 1}"],
    ["data-automation", "null"],
    ["data-automation", '{"version": 1}'],
    ["data-automation", '{"version": 1, "lanes": [null]}'],
    ["data-automation", '{"version": 1, "lanes": [{"target": "volume"}]}'],
    ["data-automation", '{"version": 1, "lanes": [{"points": []}]}'],
    ["data-fx-chain", '{"version": 1, "nodes": [{"type": "highpass", "params": {}}]}'],
    ["data-fx-chain", '{"version": 1, "nodes": []}'],
    ["data-fx-chain", '{"nodes": []}'],
    ["data-fx-chain", '{"version": 1}'],
    ["data-fx-chain", '{"version": 1, "nodes": ["x"]}'],
    ["data-fx-chain", '{"version": 1, "nodes": [{"id": "n1"}]}'],
  ] as const)("%s %s: lint flags it exactly when the render refuses it", (attr, json) => {
    expect(audioAttributeShapeError(attr, json) === null).toBe(accepts(attr, json));
  });
});

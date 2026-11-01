import { describe, expect, it } from "vitest";
import extract from "../commands/measure/extract.js";
import frames from "../commands/measure/frames.js";
import events from "../commands/measure/events.js";
import snapshot from "../commands/snapshot.js";

const aliases = (def: { args?: unknown }, key: string): string[] => {
  const arg = (def.args as Record<string, { alias?: string | string[] }>)[key];
  return [arg?.alias ?? []].flat();
};

describe("output folder flags", () => {
  it.each([
    ["measure frames", frames, "out"],
    ["measure events", events, "out"],
    ["measure extract", extract, "out"],
    ["snapshot", snapshot, "output"],
  ])("%s takes --out, --output and --output-dir", (_name, def, key) => {
    const spellings = new Set([key, ...aliases(def, key)]);
    expect([...spellings].sort()).toEqual(
      ["out", "output", "output-dir"].concat(key === "output" ? ["o"] : []).sort(),
    );
  });
});

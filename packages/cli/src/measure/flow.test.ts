import { describe, expect, it } from "vitest";
import { compareFlow, type FlowRow } from "./flow.js";

const rows = (mags: number[]): FlowRow[] =>
  mags.map((mag) => ({ mag, share: 1, tx: 0, ty: 0, scale: 1, rot: 0 }));

describe("compareFlow", () => {
  it("returns each side's mean motion with their ratio", () => {
    const c = compareFlow(rows([0.4, 0.6, 0.5]), rows([0.2, 0.3, 0.25]));
    expect([c.original_energy, c.yours_energy, c.energy_ratio]).toEqual([0.5, 0.25, 0.5]);
  });
});

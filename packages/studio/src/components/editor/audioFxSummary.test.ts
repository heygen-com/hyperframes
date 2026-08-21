import { describe, expect, it } from "vitest";
import { audioFxSummary } from "./audioFxSummary";
import type { DomEditSelection } from "./domEditingTypes";

const el = (dataAttributes: Record<string, string>): DomEditSelection =>
  ({ dataAttributes }) as unknown as DomEditSelection;

const chain = (nodes: unknown[]) => JSON.stringify({ version: 1, nodes });

describe("audioFxSummary", () => {
  it("counts a carve as one module, not as the filters behind it", () => {
    // Six bands and a level stage reading "7 effects" is the misreading the
    // grouping exists to prevent.
    const summary = audioFxSummary(
      el({
        "fx-chain": chain([
          { type: "peaking", id: "n1", fromCarve: true, params: { frequency: 400 } },
          { type: "peaking", id: "n2", fromCarve: true, params: { frequency: 1600 } },
          { type: "gain", id: "n3", fromCarve: true, params: { gain: -6 } },
        ]),
        "fx-carve": JSON.stringify({ source: "vo", strength: 0.25 }),
      }),
    );
    expect(summary).toBe("carve");
  });

  it("counts hand-built effects alongside the module", () => {
    expect(
      audioFxSummary(
        el({
          "fx-chain": chain([
            { type: "peaking", id: "n1", fromCarve: true, params: { frequency: 400 } },
            { type: "lowpass", id: "n2", params: { frequency: 8000 } },
            { type: "delay", id: "n3", params: { time: 200 } },
          ]),
        }),
      ),
    ).toBe("2 effects + carve");
  });

  it("says how many when there is no carve", () => {
    expect(audioFxSummary(el({ "fx-chain": chain([{ type: "lowpass", id: "n1" }]) }))).toBe(
      "1 effect",
    );
  });

  it("names a carve that is on but has not compiled to filters yet", () => {
    // Switching it on with no voice chosen leaves the control in this section with
    // nothing behind it; the summary should still say the section holds one.
    expect(audioFxSummary(el({ "fx-carve": JSON.stringify({ source: "", strength: 0.25 }) }))).toBe(
      "carve",
    );
  });

  it("ignores bypassed effects, as it always did", () => {
    expect(
      audioFxSummary(
        el({
          "fx-chain": chain([
            { type: "lowpass", id: "n1", enabled: false },
            { type: "delay", id: "n2" },
          ]),
        }),
      ),
    ).toBe("1 effect");
  });

  it("says none for a track with neither", () => {
    expect(audioFxSummary(el({}))).toBe("none");
  });

  it("says so when the chain cannot be read", () => {
    expect(audioFxSummary(el({ "fx-chain": "{not json" }))).toBe("unreadable");
  });
});

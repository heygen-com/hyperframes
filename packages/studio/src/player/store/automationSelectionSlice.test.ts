import { describe, expect, it } from "vitest";
import { usePlayerStore } from "./playerStore";

describe("automationSelectionSlice", () => {
  it("stores one ordered selection and clears it", () => {
    const store = usePlayerStore.getState();
    store.setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 1 });
    const sel = usePlayerStore.getState().automationSelection;
    // Ordered on write, so every consumer can assume t0 < t1.
    expect(sel).toEqual({ elementKey: "bgm", target: "volume", t0: 1, t1: 2 });
    usePlayerStore.getState().clearAutomationSelection();
    expect(usePlayerStore.getState().automationSelection).toBeNull();
  });
});

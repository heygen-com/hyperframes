import { describe, it, expect, vi } from "vitest";
import { createSignal } from "./signals";

describe("Signals", () => {
  it("allows subscription and updates", () => {
    const scale = createSignal(1);
    const listener = vi.fn();

    // Subscribing immediately calls the listener with the current value
    const unsubscribe = scale.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Updating value calls listener again
    scale.value = 2;
    expect(listener).toHaveBeenCalledWith(2);
    expect(listener).toHaveBeenCalledTimes(2);

    // Unsubscribing stops updates
    unsubscribe();
    scale.value = 3;
    expect(listener).toHaveBeenCalledTimes(2); // Still 2
  });
});

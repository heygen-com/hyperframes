import { expect, it } from "bun:test";

// scripts/run-test-lane.mjs preloads scripts/no-network.mjs for the unit lane.
it("reaches no network in the unit lane", async () => {
  await expect(fetch("https://example.com")).rejects.toThrow("No network in unit tests");
});

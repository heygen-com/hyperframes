// @vitest-environment happy-dom
import { get } from "node:http";
import { expect, it } from "vitest";

// scripts/run-test-lane.mjs imports scripts/no-network.mjs into the unit lane's vitest workers.
it("refuses happy-dom's own fetch in the unit lane", async () => {
  await expect(fetch("https://example.com")).rejects.toThrow("No network in unit tests");
});

it("refuses a node:http request to another host in the unit lane", async () => {
  const request = new Promise((resolve, reject) => {
    get("http://example.com", resolve).on("error", reject);
  });
  await expect(request).rejects.toThrow("No network in unit tests");
});

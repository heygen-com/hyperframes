import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock("../version.js", () => ({ VERSION: "0.9.28-alpha.3" }));
vi.mock("../telemetry/config.js", () => ({
  readConfig: () => state.config,
  readConfigFresh: () => state.config,
  writeConfig: (value: Record<string, unknown>) => {
    state.config = value;
  },
}));
import { cachedUpdateCheck, checkForUpdate, updateChannel } from "./updateCheck.js";
beforeEach(() => {
  state.config = {};
});
afterEach(() => vi.unstubAllGlobals());
it("keeps alpha update checks on alpha even when stable has a higher version", async () => {
  state.config = { latestVersion: "0.9.31", lastUpdateCheck: new Date().toISOString() };
  expect(cachedUpdateCheck().updateAvailable).toBe(false);
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.32-alpha.1" }) });
  vi.stubGlobal("fetch", fetch);
  expect(await checkForUpdate(true)).toMatchObject({
    latest: "0.9.32-alpha.1",
    updateAvailable: true,
  });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://registry.npmjs.org/hyperframes/alpha");
});
it("does not accept a stable registry response for an alpha installation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.31" }) }),
  );
  expect((await checkForUpdate(true)).updateAvailable).toBe(false);
});
it("does not advertise stale cached versions", () => {
  state.config = {
    latestVersion: "0.9.29-alpha.1",
    lastUpdateCheck: new Date(Date.now() - 3 * 3600000).toISOString(),
  };
  expect(cachedUpdateCheck().updateAvailable).toBe(false);
});
it("selects stable and prerelease channels from the running version", () => {
  expect(updateChannel("0.9.31")).toBe("latest");
  expect(updateChannel("0.9.31-rc.1")).toBe("rc");
});

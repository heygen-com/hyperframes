import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setupTempAuthEnv, type EnvFixture } from "../../auth/_test-utils.js";

let envFixture: EnvFixture;

beforeEach(async () => {
  envFixture = await setupTempAuthEnv("hf-logout-");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await envFixture.restore();
});

it("warns that a host access token still signs commands after logout", async () => {
  process.env["HEYGEN_ACCESS_TOKEN"] = "host-token";
  const cmd = (await import("./logout.js")).default;
  await (cmd.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({
    args: { yes: true },
  });

  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Unset HEYGEN_ACCESS_TOKEN"));
});

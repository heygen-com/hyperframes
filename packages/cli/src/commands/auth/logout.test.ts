import { join } from "node:path";
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

it("requires an explicit confirmation without a terminal", async () => {
  const cmd = (await import("./logout.js")).default;
  await expect(
    (cmd.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({ args: {} }),
  ).rejects.toThrow("auth logout --yes");
});

// fails without the fix: the folder name is printed as it is on disk.
it.skipIf(process.platform === "win32")(
  "shows control characters in the removed credential file's path as text",
  async () => {
    const ESC = String.fromCharCode(27);
    process.env["HYPERFRAMES_CONFIG_DIR"] = join(envFixture.dir, `cfg od${ESC}[2Jd\x07`);
    const cmd = (await import("./logout.js")).default;
    await (cmd.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({
      args: { yes: true },
    });

    const text = vi
      .mocked(console.log)
      .mock.calls.map((call) => call.join(" "))
      .join("\n")
      .replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
    expect(text).toContain("cfg od\\x1b[2Jd\\x07");
    expect(text).not.toContain(ESC);
    expect(text).not.toContain("\x07");
  },
);

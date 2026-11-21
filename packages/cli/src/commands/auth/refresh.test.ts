import { afterEach, expect, it, vi } from "vitest";
import { AuthError } from "../../auth/errors.js";

const refresh = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock("../../auth/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/index.js")>()),
  assertOAuthConfiguredOrExit: () => undefined,
  readStore: async () => ({
    source: "file",
    credentials: { oauth: { refresh_token: "stored" } },
  }),
  refreshTokens: async () => {
    if (refresh.error) throw refresh.error;
  },
}));

import refreshCommand from "./refresh.js";

afterEach(() => {
  refresh.error = null;
  vi.restoreAllMocks();
});

// fails without the fix: the refusal and its hint reached the terminal with their control characters live.
it("prints a refused refresh's control characters as visible escapes", async () => {
  const esc = String.fromCharCode(27);
  refresh.error = new AuthError(
    "REFRESH_FAILED",
    `Refresh refused${esc}[2J`,
    `Run auth login${esc}]0;t${String.fromCharCode(7)}`,
  );
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });

  await expect(refreshCommand.run?.({ args: {}, rawArgs: [] } as never)).rejects.toMatchObject({
    name: "CliRuntimeError",
  });

  const printed = lines.join("\n");
  expect(printed).toContain("Refresh refused\\x1b[2J");
  expect(printed).toContain("Run auth login\\x1b]0;t\\x07");
  expect(printed).not.toContain(`${esc}[2J`);
  expect(printed).not.toContain(`${esc}]`);
});

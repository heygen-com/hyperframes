import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

// Built rather than written: a literal control character in the source is a lint error.
const bell = String.fromCharCode(7);
const latest = `9.9.9${bell}`;

vi.mock("../utils/updateCheck.js", async (orig) => ({
  ...(await orig<typeof import("../utils/updateCheck.js")>()),
  checkForUpdate: vi.fn(async () => ({ current: "0.7.48", latest, updateAvailable: true })),
}));
const outro = vi.hoisted(() => vi.fn());
vi.mock("../ui/prompts.js", async (orig) => ({
  ...(await orig<typeof import("../ui/prompts.js")>()),
  intro: vi.fn(),
  outro,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
}));

const { default: upgrade } = await import("./upgrade.js");

describe("upgrade command: a version that is not a plain version number", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    outro.mockClear();
    consumeCommandResult();
  });

  it("shows its control characters as text in a check", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(upgrade, { rawArgs: ["--check"] });

    const printed = [...log.mock.calls, ...outro.mock.calls].map((call) => call.join(" "));
    expect(printed.join("\n")).not.toContain(bell);
    expect(printed.some((line) => line.includes("Latest:") && line.includes("9.9.9\\x07"))).toBe(
      true,
    );
    expect(printed.at(-1)).toContain("Update available: v9.9.9\\x07");
  });

  it("shows its control characters as text for a project's pins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-upgrade-out-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(upgrade, { rawArgs: ["--project", dir] });

      const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(printed).not.toContain(bell);
      expect(printed).toContain("Project pins already on hyperframes@9.9.9\\x07");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

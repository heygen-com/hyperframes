import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import catchUp from "./catch-up.js";
import { APP_HISTORY, markSeen, readSeen } from "../utils/appHistory.js";

describe("catch-up", () => {
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "hf-home-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  it("marks seen only up to the newest turn it showed, so a turn written after the read shows next time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-catch-up-"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, ".hyperframes"));
    const shown = "2026-01-01T10:00:00.000Z";
    writeFileSync(
      join(dir, ".hyperframes", APP_HISTORY),
      `${JSON.stringify({ at: shown, engine: "claude", asked: "a", did: "b", files: [] })}\n`,
    );
    markSeen(dir, {
      at: Date.parse("2026-01-01T09:00:00Z"),
      checked: Date.parse("2026-01-01T09:00:00Z"),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await catchUp.run?.({ args: { _: [], dir, json: true }, rawArgs: [], cmd: catchUp });
    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    log.mockRestore();
    expect(printed.turns).toHaveLength(1);
    expect(readSeen(dir).at).toBe(Date.parse(shown));
  });
});

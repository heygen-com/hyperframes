import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import catchUp from "./catch-up.js";
import { APP_HISTORY, markSeen, noteHandoff, readSeen } from "../utils/appHistory.js";

describe("catch-up", () => {
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "hf-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    return () => vi.unstubAllEnvs();
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

  it("lists only what the app appended after the hand-off, never turns the project came with", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-catch-up-"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, ".hyperframes"));
    const history = join(dir, ".hyperframes", APP_HISTORY);
    const line = (at: string, asked: string) =>
      `${JSON.stringify({ at, engine: "claude", asked, did: "Done.", files: [] })}\n`;
    writeFileSync(history, line("2000-01-01T00:00:00.000Z", "shipped, already past"));
    appendFileSync(history, line("2001-01-01T00:00:00.000Z", "shipped, dated after the hand-off"));
    noteHandoff(dir, Date.parse("2000-06-01T00:00:00Z"));
    const run = async (json: boolean): Promise<string> => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await catchUp.run?.({ args: { _: [], dir, json }, rawArgs: [], cmd: catchUp });
      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      log.mockRestore();
      return printed;
    };
    expect(JSON.parse(await run(true)).turns).toEqual([]);
    expect(await run(false)).not.toContain("shipped");

    appendFileSync(history, line("2026-01-01T10:00:00.000Z", "mine"));
    const human = await run(false);
    expect(human).toContain("The person: mine");
    expect(human).not.toContain("shipped");
    expect(JSON.parse(await run(true)).turns).toEqual([]);
  });

  it("prints history, file names and the folder name with control characters as visible escapes", async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const osc = `${esc}]52;c;cHduZWQ=${bel}`;
    // Windows refuses control characters in file and folder names, so there only the history
    // text carries them.
    const names = process.platform !== "win32";
    const parent = mkdtempSync(join(tmpdir(), "hf-catch-up-"));
    const dir = join(parent, names ? `video${esc}[2J` : "video");
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const seenAt = Date.parse("2026-01-01T09:00:00Z");
    markSeen(dir, { at: seenAt, checked: seenAt });
    writeFileSync(join(dir, names ? `scene${esc}[1A.html` : "scene.html"), "<html></html>");
    writeFileSync(
      join(dir, ".hyperframes", APP_HISTORY),
      `${JSON.stringify({
        at: "2026-01-01T10:00:00.000Z",
        engine: "claude",
        asked: `make it red${osc}`,
        did: `done\r${esc}[2Kfaked`,
        files: [`a${bel}.html`],
      })}\n`,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await catchUp.run?.({ args: { _: [], dir, json: false }, rawArgs: [], cmd: catchUp });
    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
    log.mockRestore();
    const colors = new RegExp(`${esc}\\[[0-9;]*m`, "g");
    const shown = printed.replace(colors, "");

    const controls = [...shown].filter((ch) => {
      const code = ch.charCodeAt(0);
      return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    });
    expect(controls).toEqual([]);
    expect(shown).toContain("make it red\\x1b]52;c;cHduZWQ=\\x07");
    expect(shown).toContain("done\\x0d\\x1b[2Kfaked");
    expect(shown).toContain("a\\x07.html");
    if (names) {
      expect(shown).toContain("scene\\x1b[1A.html");
      expect(shown).toContain("video\\x1b[2J");
    }
  });
});

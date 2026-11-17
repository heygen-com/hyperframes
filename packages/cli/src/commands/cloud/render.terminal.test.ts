import { runCommand } from "citty";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import render from "./render.js";
import { consumeCommandResult } from "../../utils/commandResult.js";

// Windows refuses control characters in folder names.
it.skipIf(process.platform === "win32")(
  "prints a folder name with control characters as visible escapes",
  async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const parent = mkdtempSync(join(tmpdir(), "hf-cloud-render-"));
    const dir = join(parent, `video${esc}]0;x${String.fromCharCode(7)}${esc}[2J`);
    mkdirSync(dir);
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-duration="1"></div></body></html>`,
    );
    vi.stubEnv("HEYGEN_API_KEY", "fixture-key");
    vi.stubGlobal("fetch", vi.fn());
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runCommand(render, { rawArgs: [dir, "--dry-run"] });
      const human = log.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(human.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
      expect(human).toContain("Zipping ");
      expect(human).toContain("video\\x1b]0;x\\x07\\x1b[2J");
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      consumeCommandResult();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

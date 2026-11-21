import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

vi.mock("../utils/desktopApp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/desktopApp.js")>()),
  desktopInstalled: () => true,
  openInDesktop: () => ({ opened: true, app: "HyperFrames", handedOver: null }),
}));
vi.mock("./previewLifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./previewLifecycle.js")>()),
  readBackgroundPreviewStatus: async () => ({ pid: 1, port: 3002, projectDir: "", logPath: "x" }),
  stopBackgroundPreview: async (dir: string) => {
    throw new Error(`could not stop ${dir}`);
  },
}));

const { default: open } = await import("./open.js");

// Windows refuses control characters in folder names.
it.skipIf(process.platform === "win32")(
  "prints a folder name with control characters as visible escapes",
  async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const parent = mkdtempSync(join(tmpdir(), "hf-open-"));
    const dir = join(parent, `video${esc}]0;x${String.fromCharCode(7)}${esc}[2J`);
    mkdirSync(dir);
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(open, { rawArgs: [dir] });
      const human = log.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(human.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
      expect(human).toContain("Opening ");
      expect(human).toContain("Couldn't stop");
      expect(human.match(/video\\x1b\]0;x\\x07\\x1b\[2J/g)?.length).toBeGreaterThanOrEqual(2);
    } finally {
      log.mockRestore();
      consumeCommandResult();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

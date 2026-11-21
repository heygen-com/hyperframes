import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { waitForTestCondition } from "../utils/processTestUtils.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "pageNetwork.signal.fixture.ts");

// fails without the fix: the CLI's Ctrl-C handler exits without waiting for the profile's removal, so its
// hf-cli-profile- folder stays in the temp folder.
it.skipIf(process.platform === "win32")(
  "removes a restricted browser's temp profile when the CLI stops on Ctrl-C",
  async () => {
    const testDir = mkdtempSync(join(tmpdir(), "hf-page-network-signal-"));
    const readyPath = join(testDir, "ready.json");
    const child = spawn(process.execPath, ["--import", "tsx", fixturePath, readyPath], {
      stdio: "ignore",
    });
    try {
      await waitForTestCondition(() => existsSync(readyPath), 20_000);
      const { userDataDir } = JSON.parse(readFileSync(readyPath, "utf8")) as {
        userDataDir: string;
      };
      expect(existsSync(userDataDir)).toBe(true);
      const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
      child.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(existsSync(userDataDir)).toBe(false);
    } finally {
      child.kill("SIGKILL");
      rmSync(testDir, { recursive: true, force: true });
    }
  },
  30_000,
);

import childProcess from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import "./hideChildConsoles.js";
import { processIsAlive } from "./processTree.js";
import { warmTestExecutable } from "./processTestUtils.js";

// Loaded into a node copy named taskkill.exe: stands in for a taskkill stuck on a hung WMI, up to 60 s.
const HANG = `const { existsSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
if (basename(process.execPath).toLowerCase() === "taskkill.exe") {
  writeFileSync(join(__dirname, "pid"), String(process.pid));
  const cell = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 600 && !existsSync(join(__dirname, "release")); i++) Atomics.wait(cell, 0, 0, 100);
  process.exit(0);
}
`;

describe.runIf(process.platform === "win32")("a hung taskkill", () => {
  it("is ended within its limit when puppeteer runs it synchronously", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-taskkill-"));
    copyFileSync(process.execPath, join(dir, "taskkill.exe"));
    warmTestExecutable(join(dir, "taskkill.exe"), ["-e", ""]);
    writeFileSync(join(dir, "hang.cjs"), HANG);
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "Path";
    const env = {
      ...process.env,
      [pathKey]: `${dir};${process.env[pathKey] ?? ""}`,
      NODE_OPTIONS: `--require "${join(dir, "hang.cjs").replaceAll("\\", "/")}"`,
    };
    const started = Date.now();
    try {
      // The exact call @puppeteer/browsers makes to end a browser on Windows.
      expect(() => childProcess.execSync("taskkill /pid 999999 /T /F", { env })).toThrow();
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(processIsAlive(Number(readFileSync(join(dir, "pid"), "utf8")))).toBe(false);
    } finally {
      writeFileSync(join(dir, "release"), "");
      rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
    }
  }, 90_000);
});

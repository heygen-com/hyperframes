import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { processReadArgs } from "./windowsProcesses.js";

const src = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(src, "utils", "processes.ps1");

// Norton 360's behaviour shield flagged powershell.exe started with process-killing command text (Get-CimInstance
// Win32_Process + Stop-Process -Force); its file shield reads script files.
const SHIPPED = readdirSync(src, { recursive: true, withFileTypes: true })
  .filter((each) => each.isFile() && /\.(ts|mjs|ps1)$/.test(each.name))
  .filter((each) => !/\.(test|fixture)\.ts$/.test(each.name))
  .map((each) => join(each.parentPath, each.name));

const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|#|\*|\/\*)/.test(line))
    .join("\n");

describe("the PowerShell the CLI starts on Windows", () => {
  it("is only ever the shipped processes.ps1, run as a file with plain arguments", () => {
    for (const args of [processReadArgs("table"), processReadArgs("identity", 42)]) {
      expect(args[args.indexOf("-File") + 1]).toBe(SCRIPT);
      expect(args.some((arg) => /^-(command|encodedcommand|ec)$/i.test(arg))).toBe(false);
    }
    expect(processReadArgs("identity", 42).slice(-2)).toEqual(["identity", "42"]);
    expect(existsSync(SCRIPT)).toBe(true);
    const copy = readFileSync(join(src, "..", "scripts", "build-copy.mjs"), "utf8");
    expect(copy).toContain("processes.ps1");
  });

  it("is started only with processReadArgs, so no flag or plain argument can carry command text", () => {
    let starts = 0;
    for (const file of SHIPPED) {
      const text = code(file);
      for (const start of text.matchAll(/["'`]powershell(?:\.exe)?["'`]\s*,\s*/gi)) {
        starts++;
        const args = text.slice(start.index + start[0].length);
        expect(args.startsWith("processReadArgs("), `${file}: ${args.slice(0, 60)}`).toBe(true);
      }
    }
    expect(starts).toBeGreaterThanOrEqual(5);
  });

  it("is never given command text, and nothing outside processes.ps1 reads or ends processes through it", () => {
    expect(SHIPPED.length).toBeGreaterThan(100);
    for (const file of SHIPPED) {
      const text = code(file);
      expect(text, file).not.toMatch(
        /["'`]-(Command|EncodedCommand|ec)["'`]|FromBase64String|\[scriptblock\]::Create|Add-Type|Invoke-Expression|Stop-Process/i,
      );
      if (file !== SCRIPT) expect(text, file).not.toMatch(/Get-CimInstance|Win32_Process/);
    }
  });
});

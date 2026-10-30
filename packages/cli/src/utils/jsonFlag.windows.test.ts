import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJsonFlag } from "./jsonFlag.js";

// A .cmd launcher run from PowerShell, as npm's hyperframes.cmd is.
describe.runIf(process.platform === "win32")(
  "JSON flags through a PowerShell .cmd launcher",
  () => {
    let dir = "";
    let launcher = "";
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "hf-json-flag-"));
      launcher = join(dir, "launch.cmd");
      writeFileSync(
        join(dir, "echo.mjs"),
        'import { readFileSync } from "node:fs";\nprocess.stdout.write(process.argv[2] === "-" ? readFileSync(0).toString("base64") : process.argv[2]);\n',
      );
      writeFileSync(launcher, '@node "%~dp0echo.mjs" %*\r\n');
      writeFileSync(join(dir, "g.json"), '{"preset":"warm-daylight","intensity":0.6}');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const powershell = (script: string) =>
      spawnSync(
        "powershell.exe",
        ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
        { encoding: "utf8" },
      ).stdout;

    it("delivers a file path intact", () => {
      const arg = powershell(`& '${launcher}' '${join(dir, "g.json")}'`);
      expect(readJsonFlag("--grading", arg)).toEqual({ preset: "warm-daylight", intensity: 0.6 });
    });

    it("delivers piped JSON through -, in whatever bytes PowerShell pipes", () => {
      const piped = Buffer.from(
        powershell(`'{"preset":"skin-soft"}' | & '${launcher}' -`),
        "base64",
      );
      const file = join(dir, "piped.json");
      writeFileSync(file, piped);
      expect(readJsonFlag("--grading", file)).toEqual({ preset: "skin-soft" });
    });
  },
);

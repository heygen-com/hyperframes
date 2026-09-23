import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

function run(scriptsDir, script, args) {
  return execFileSync(process.execPath, [join(scriptsDir, script), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("published memory scripts run without reaching outside the skill", () => {
  const scratchDir = mkdtempSync(join(tmpdir(), "media-use-compat-"));
  const skillDir = join(scratchDir, "media-use");
  cpSync(new URL("..", import.meta.url), skillDir, { recursive: true });
  const scriptsDir = join(skillDir, "scripts");
  const projectDir = join(scratchDir, "project");
  try {
    run(scriptsDir, "prefs.mjs", ["get", "--hyperframes", projectDir, "--json"]);
    run(scriptsDir, "recipe.mjs", ["list", "--hyperframes", projectDir, "--json"]);
    run(scriptsDir, "transcribe.mjs", ["--help"]);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

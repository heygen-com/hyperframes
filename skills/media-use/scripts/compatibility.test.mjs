import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

process.env.HYPERFRAMES_MEDIA_HOME = mkdtempSync(join(tmpdir(), "media-use-compat-home-"));

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

test("published audio helpers import without the CLI package tree", () => {
  const root = mkdtempSync(join(tmpdir(), "media-use-audio-"));
  const skill = join(root, "media-use");
  try {
    cpSync(new URL("..", import.meta.url), skill, { recursive: true });
    for (const helper of ["heygen.mjs", "tts.mjs"])
      run(join(skill, "audio/scripts/lib"), helper, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

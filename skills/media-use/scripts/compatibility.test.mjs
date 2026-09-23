import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

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

for (const name of ["faceless-explainer", "pr-to-video", "product-launch-video"]) {
  test(name + " assembles from its installed directory alone", () => {
    const root = mkdtempSync(join(tmpdir(), "installed-workflow-"));
    try {
      const skill = join(root, name);
      cpSync(new URL("../../" + name, import.meta.url), skill, { recursive: true });
      const project = join(root, "project");
      mkdirSync(join(project, "compositions/frames"), { recursive: true });
      writeFileSync(
        join(project, "STORYBOARD.md"),
        "---\nformat: 1920x1080\nmessage: Test\n---\n\n## Frame 1\n- duration: 3s\n- src: compositions/frames/01-a.html\n",
      );
      writeFileSync(
        join(project, "compositions/frames/01-a.html"),
        '<template><div data-composition-id="01-a" data-duration="3" data-width="1920" data-height="1080"><section class="clip" data-start="0" data-duration="3"></section></div></template>',
      );
      run(join(skill, "scripts"), "assemble-index.mjs", [
        "--hyperframes",
        project,
        "--storyboard",
        join(project, "STORYBOARD.md"),
      ]);
      assert.match(readFileSync(join(project, "index.html"), "utf8"), /01-a/);
      importPacketBuilder(join(skill, "scripts/frame-packets.mjs"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("general-video packet builder starts from its installed directory alone", () => {
  const root = mkdtempSync(join(tmpdir(), "installed-packets-"));
  try {
    cpSync(new URL("../../general-video", import.meta.url), root, { recursive: true });
    importPacketBuilder(join(root, "scripts/frame-packets.mjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function importPacketBuilder(path) {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'const m = await import(process.argv[1]); if (typeof m.buildFramePackets !== "function") throw new Error("missing builder");',
      pathToFileURL(path).href,
    ],
    { stdio: "pipe" },
  );
}

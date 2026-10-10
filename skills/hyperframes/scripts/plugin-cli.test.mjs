import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { invocation, pluginVersion } from "./plugin-cli.mjs";

function fixture(t, manifest = "plugin.json", version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "hf-plugin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills/hyperframes/scripts/lib"), { recursive: true });
  mkdirSync(join(root, manifest, ".."), { recursive: true });
  writeFileSync(join(root, manifest), JSON.stringify({ name: "hyperframes", version }));
  const launcher = join(root, "skills/hyperframes/scripts/plugin-cli.mjs");
  copyFileSync(new URL("./plugin-cli.mjs", import.meta.url), launcher);
  copyFileSync(
    new URL("./lib/main-module.mjs", import.meta.url),
    join(root, "skills/hyperframes/scripts/lib/main-module.mjs"),
  );
  return { root, launcher };
}

for (const manifest of [
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "gemini-extension.json",
]) {
  test(`locates ${manifest} without repository packages`, (t) => {
    const { root } = fixture(t, manifest);
    assert.equal(pluginVersion(root), "1.2.3");
  });
}

test("rejects missing and floating plugin versions", (t) => {
  const { root } = fixture(t, "plugin.json", "latest");
  assert.throws(() => pluginVersion(root), /Invalid HyperFrames plugin release/);
  rmSync(join(root, "plugin.json"));
  assert.throws(() => pluginVersion(root), /No HyperFrames plugin manifest/);
});

test("pins CLI, suppresses standalone refresh, preserves unrelated environment", () => {
  const result = invocation(["init", "project with spaces", "--non-interactive"], {
    version: "1.2.3",
    platform: "darwin",
    env: { PATH: "/bin", HYPERFRAMES_SKIP_SKILLS: "0" },
  });
  assert.equal(result.command, "npx");
  assert.deepEqual(result.args, [
    "--yes",
    "hyperframes@1.2.3",
    "init",
    "project with spaces",
    "--non-interactive",
  ]);
  assert.deepEqual(result.env, {
    PATH: "/bin",
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_SKILL_PKG_VERSION: "1.2.3",
    HYPERFRAMES_PLUGIN_VERSION: "1.2.3",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
  });
  assert.throws(() => invocation(["skills", "update"], { version: "1.2.3" }), /plugin manager/);
});

test("Windows launches npx through Node without shell argument interpretation", () => {
  const result = invocation(["render", "a & b"], {
    version: "1.2.3",
    platform: "win32",
    node: String.raw`C:\Program Files\nodejs\node.exe`,
    env: { npm_execpath: String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js` },
    pathExists: (p) => p === String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js`,
  });
  assert.equal(result.command, String.raw`C:\Program Files\nodejs\node.exe`);
  assert.deepEqual(result.args, [
    String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js`,
    "--yes",
    "hyperframes@1.2.3",
    "render",
    "a & b",
  ]);
  assert.throws(
    () => invocation([], { version: "1.2.3", platform: "win32", env: {}, pathExists: () => false }),
    /Cannot find npx/,
  );
});

test("installed helper keeps cwd, arguments, release environment and exit code", (t) => {
  const { root, launcher } = fixture(t);
  const project = join(root, "user project");
  mkdirSync(project);
  const helper = join(root, "helper.mjs");
  writeFileSync(
    helper,
    "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), skip: process.env.HYPERFRAMES_SKIP_SKILLS, version: process.env.HYPERFRAMES_SKILL_PKG_VERSION })); process.exit(7);",
  );
  const before = readFileSync(join(root, "plugin.json"), "utf8");
  const result = spawnSync(
    process.execPath,
    [launcher, "--script", helper, "literal $value & spaces"],
    { cwd: project, encoding: "utf8" },
  );
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    cwd: realpathSync(project),
    args: ["literal $value & spaces"],
    skip: "1",
    version: "1.2.3",
  });
  assert.equal(readFileSync(join(root, "plugin.json"), "utf8"), before);
});

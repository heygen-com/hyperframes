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
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { invocation, npmFolder, pluginVersion } from "./plugin-cli.mjs";

function fixture(t, manifest = "plugin.json", version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "hf-plugin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills/hyperframes/scripts/lib"), { recursive: true });
  mkdirSync(join(root, manifest, ".."), { recursive: true });
  writeFileSync(join(root, manifest), JSON.stringify({ name: "hyperframes", version }));
  const launcher = join(root, "skills/hyperframes/scripts/plugin-cli.mjs");
  copyFileSync(new URL("./plugin-cli.mjs", import.meta.url), launcher);
  for (const lib of ["main-module.mjs", "windows-exe-search.mjs"]) {
    copyFileSync(
      new URL(`./lib/${lib}`, import.meta.url),
      join(root, "skills/hyperframes/scripts/lib", lib),
    );
  }
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
    cwd: "/work/project",
    npmCwd: "/home/person",
  });
  assert.equal(result.command, "npx");
  assert.equal(result.cwd, "/home/person");
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
    HYPERFRAMES_PLUGIN_CWD: "/work/project",
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
    npmCwd: String.raw`C:\Users\person`,
  });
  assert.equal(result.command, String.raw`C:\Program Files\nodejs\node.exe`);
  assert.equal(result.cwd, String.raw`C:\Users\person`);
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
    "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), skip: process.env.HYPERFRAMES_SKIP_SKILLS, version: process.env.HYPERFRAMES_SKILL_PKG_VERSION, cli: process.env.HYPERFRAMES_CLI_ENTRY })); process.exit(7);",
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
    cli: realpathSync(launcher),
  });
  assert.equal(readFileSync(join(root, "plugin.json"), "utf8"), before);
});

test("on Windows, a helper and the programs it starts skip the working-directory lookup", (t) => {
  const { root, launcher } = fixture(t);
  const helper = join(root, "helper.mjs");
  writeFileSync(
    helper,
    "console.log(JSON.stringify(process.env.NoDefaultCurrentDirectoryInExePath ?? null));",
  );
  const asWindows = join(root, "as-windows.mjs");
  writeFileSync(asWindows, 'Object.defineProperty(process, "platform", { value: "win32" });');
  const run = (env) =>
    spawnSync(
      process.execPath,
      ["--import", pathToFileURL(asWindows).href, launcher, "--script", helper],
      { cwd: root, encoding: "utf8", env: { ...env, NODE_OPTIONS: "" } },
    );
  const stdoutOf = (result) => {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const { NoDefaultCurrentDirectoryInExePath: _, ...env } = process.env;

  assert.equal(stdoutOf(run(env)), "1");
  assert.equal(stdoutOf(run({ ...env, NoDefaultCurrentDirectoryInExePath: "yes" })), "yes");
});

test(
  "npx starts outside the project, so its packages, bin links and .npmrc cannot pick the CLI",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, launcher } = fixture(t);
    const home = join(root, "home");
    const bin = join(root, "bin");
    const project = join(root, "user project");
    mkdirSync(home);
    mkdirSync(bin);
    mkdirSync(join(project, "node_modules/.bin"), { recursive: true });
    writeFileSync(
      join(project, ".npmrc"),
      "registry=http://127.0.0.1:9/\nscript-shell=/bin/false\n",
    );
    writeFileSync(join(project, "package.json"), '{"name":"hyperframes","bin":"x.js"}');
    writeFileSync(join(project, "node_modules/.bin/hyperframes"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(
      join(bin, "npx"),
      `#!${process.execPath}\nconsole.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),project:process.env.HYPERFRAMES_PLUGIN_CWD}));`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [launcher, "--version"], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      cwd: realpathSync(home),
      args: ["--yes", "hyperframes@1.2.3", "--version"],
      project: realpathSync(project),
    });
  },
);

test("starts npx in the home folder and never falls back to a shared folder", () => {
  assert.equal(
    npmFolder("/home/person", () => true),
    "/home/person",
  );
  assert.throws(() => npmFolder("", () => true), /Cannot find your home folder/);
  assert.throws(() => npmFolder("/home/gone", () => false), /Cannot find your home folder/);
  // Helper scripts never start npx, so they run without a home folder.
  const script = invocation(["--script", "helper.mjs"], {
    version: "1.2.3",
    cwd: "/project",
  });
  assert.equal(script.cwd, "/project");
});

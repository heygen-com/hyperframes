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
import { invocation, npmFolder, pluginVersion, STANDALONE_CLI } from "./plugin-cli.mjs";

// The bundle is `<base>/<bundle>`; a test's project, home and tools go elsewhere under `<base>`.
function fixture(t, manifest = "plugin.json", version = "1.2.3", bundle = "plugin") {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "hf-plugin-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, bundle);
  mkdirSync(join(root, "skills/hyperframes/scripts/lib"), { recursive: true });
  if (manifest) {
    mkdirSync(join(root, manifest, ".."), { recursive: true });
    writeFileSync(join(root, manifest), JSON.stringify({ name: "hyperframes", version }));
  }
  const launcher = join(root, "skills/hyperframes/scripts/plugin-cli.mjs");
  copyFileSync(new URL("./plugin-cli.mjs", import.meta.url), launcher);
  for (const lib of ["main-module.mjs", "windows-exe-search.mjs"]) {
    copyFileSync(
      new URL(`./lib/${lib}`, import.meta.url),
      join(root, "skills/hyperframes/scripts/lib", lib),
    );
  }
  return { base, root, launcher };
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

test("rejects a floating plugin version and reads no manifest as a standalone install", (t) => {
  const { root } = fixture(t, "plugin.json", "latest");
  assert.throws(() => pluginVersion(root), /Invalid HyperFrames plugin release/);
  rmSync(join(root, "plugin.json"));
  assert.equal(pluginVersion(root), undefined);
});

test("a standalone install runs the newest CLI that moves into the project, and manages its own skills", () => {
  const result = invocation(["skills", "update"], {
    version: null,
    platform: "darwin",
    env: { PATH: "/bin" },
    cwd: "/work/project",
    npmCwd: "/home/person",
  });
  assert.equal(STANDALONE_CLI, "hyperframes@>=0.9.65");
  assert.equal(result.command, "npx");
  assert.equal(result.cwd, "/home/person");
  assert.deepEqual(result.args, ["--yes", STANDALONE_CLI, "skills", "update"]);
  assert.deepEqual(result.env, { PATH: "/bin", HYPERFRAMES_PLUGIN_CWD: "/work/project" });
});

test("manifest pins and standalone selectors use the same exact release syntax", (t) => {
  const { root } = fixture(t);
  for (const version of ["1.0.0-rc.1+build.2", "01.2.3", "1.0.0-01", "1.0.0-rc..1"]) {
    writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "hyperframes", version }));
    const select = () =>
      invocation(["--cli-version", version, "--version"], { version: null, platform: "linux" });
    if (version === "1.0.0-rc.1+build.2") {
      assert.equal(pluginVersion(root), version);
      assert.ok(select().args.includes(`hyperframes@${version}`));
    } else {
      assert.throws(() => pluginVersion(root), /Invalid HyperFrames plugin release/);
      assert.throws(select, /exact HyperFrames version/);
    }
  }
});

test("standalone release selection keeps npm in the home folder and passes only CLI arguments", () => {
  const options = {
    version: null,
    platform: "linux",
    cwd: "/project",
    npmCwd: "/home/person",
    env: {},
  };
  for (const [release, args] of [
    ["latest", ["upgrade", "--project", ".", "--check"]],
    ["0.9.65+build-1", ["--version"]],
    ["1.0.0-rc.1", ["reverse", "start", "a b.mp4"]],
  ]) {
    const run = invocation(["--cli-version", release, ...args], options);
    assert.equal(run.cwd, options.npmCwd);
    assert.deepEqual(run.args, ["--yes", `hyperframes@${release}`, ...args]);
    assert.deepEqual(run.env, { HYPERFRAMES_PLUGIN_CWD: options.cwd });
  }
  for (const release of [
    undefined,
    "",
    "beta",
    "^1.2.3",
    "./cli",
    "--version",
    "1.2.3-01",
    "01.2.3",
    "1.2.3+",
  ]) {
    assert.throws(
      () => invocation(["--cli-version", release], options),
      /requires latest or an exact/,
    );
  }
  for (const release of ["0.9.33", "0.9.65-rc.1+build"]) {
    assert.throws(() => invocation(["--cli-version", release], options), /0\.9\.65 or newer/);
  }
  assert.throws(
    () => invocation(["--cli-version", "latest"], { version: "1.2.3" }),
    /plugin manager/,
  );
});

// fails without the fix: a standalone selection below the security floor ran, so a pin copied from a
// received project's package.json could start a CLI without the protections for received projects.
test("a standalone selection older than the floor is refused, by flag or by environment", () => {
  const options = { version: null, platform: "linux", npmCwd: "/home/person", env: {} };
  const tooOld = /lacks protections for received projects; this launcher runs 0\.9\.65 or newer/;
  for (const release of ["0.9.34", "0.9.63", "0.9.64"]) {
    assert.throws(() => invocation(["--cli-version", release, "check"], options), tooOld);
    const env = { HYPERFRAMES_STANDALONE_CLI_VERSION: release };
    assert.throws(() => invocation(["check"], { ...options, env }), tooOld);
    assert.throws(() => invocation(["--script", "helper.mjs"], { ...options, env }), tooOld);
  }
  for (const release of ["latest", "0.9.65", "0.10.0"]) {
    const env = { HYPERFRAMES_STANDALONE_CLI_VERSION: release };
    const spec = `hyperframes@${release}`;
    assert.equal(invocation(["--cli-version", release, "check"], options).args[1], spec);
    assert.equal(invocation(["check"], { ...options, env }).args[1], spec);
    const helper = invocation(["--script", "helper.mjs"], { ...options, env });
    assert.equal(helper.env.HYPERFRAMES_STANDALONE_CLI_VERSION, release);
  }
});

test("a standalone helper passes its selected release to its own CLI calls", () => {
  const options = { version: null, platform: "linux", npmCwd: "/home/person", env: {} };
  const helper = invocation(["--cli-version", "1.2.3", "--script", "helper.mjs"], options);
  assert.deepEqual(helper.args, ["helper.mjs"]);
  const nested = invocation(["--version"], { ...options, env: helper.env });
  assert.deepEqual(nested.args, ["--yes", "hyperframes@1.2.3", "--version"]);
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
  const { base, root, launcher } = fixture(t);
  const project = join(base, "user project");
  mkdirSync(project);
  const helper = join(base, "helper.mjs");
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

// fails without the fix: a standalone install had no launcher, so the skills ran `npx hyperframes`
// in the project and npm took the project's bin, node_modules/.bin or .npmrc.
for (const [install, manifest, spec] of [
  ["plugin", "plugin.json", "hyperframes@1.2.3"],
  ["standalone", null, STANDALONE_CLI],
]) {
  test(
    `${install} install: npx starts outside the project, so its packages, bin links and .npmrc cannot pick the CLI`,
    { skip: process.platform === "win32" },
    (t) => {
      const { base, launcher } = fixture(t, manifest);
      const home = join(base, "home");
      const bin = join(base, "bin");
      const project = join(base, "user project");
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
        args: ["--yes", spec, "--version"],
        project: realpathSync(project),
      });
    },
  );
}

test("rejects a plugin release older than the first one this launcher runs", (t) => {
  for (const version of ["0.9.33", "0.9.64", "0.9.65-alpha.1", "0.8.99"]) {
    const { root } = fixture(t, "plugin.json", version);
    assert.throws(() => pluginVersion(root), /this launcher runs 0\.9\.65 or newer/);
  }
  for (const version of ["0.9.65", "0.10.0", "1.0.0-beta.1"]) {
    const { root } = fixture(t, "plugin.json", version);
    assert.equal(pluginVersion(root), version);
  }
});

test("a bundle keeps its pin when the CLI works in a project beside it", (t) => {
  const { base, root } = fixture(t);
  assert.equal(pluginVersion(root, join(base, "user project")), "1.2.3");
});

for (const bundle of [
  "home/.claude/plugins/cache/hyperframes/hyperframes/1.2.3",
  "home/.cursor/plugins/local/hyperframes",
  "home/.gemini/extensions/hyperframes",
]) {
  test(`a plugin manager's bundle at ${bundle} keeps its pin from home or a project`, (t) => {
    const { base, root } = fixture(t, "plugin.json", "1.2.3", bundle);
    for (const workDir of ["home", "home/work/project", "elsewhere"]) {
      mkdirSync(join(base, workDir), { recursive: true });
      assert.equal(pluginVersion(root, join(base, workDir)), "1.2.3", workDir);
    }
  });
}

// fails without the fix: a manifest beside a project-level skills install pinned an old CLI and
// turned off update checks and standalone skill refreshes.
for (const [layout, bundle, workDir] of [
  [".agents", "user project/.agents", "user project"],
  [".claude", "user project/.claude", "user project"],
  [".claude, run from a subfolder", "user project/.claude", "user project/sub"],
  ["the project's skills folder", "user project", "user project"],
  ["the project's skills folder, run from a subfolder", "user project", "user project/sub"],
  ["a monorepo package, run from the monorepo", "user project/packages/video", "user project"],
]) {
  for (const manifest of ["plugin.json", ".claude-plugin/plugin.json", "gemini-extension.json"]) {
    test(
      `a ${manifest} beside skills in ${layout} leaves the call as it is without one`,
      { skip: process.platform === "win32" },
      (t) => {
        const { base, root, launcher } = fixture(t, manifest, "0.9.40", bundle);
        const home = join(base, "home");
        const bin = join(base, "bin");
        const cwd = join(base, workDir);
        for (const dir of [home, bin, cwd]) mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(bin, "npx"),
          `#!${process.execPath}\nconst e=process.env;console.log(JSON.stringify({args:process.argv.slice(2),skip:e.HYPERFRAMES_SKIP_SKILLS,noUpdate:e.HYPERFRAMES_NO_UPDATE_CHECK,plugin:e.HYPERFRAMES_PLUGIN_VERSION,pkg:e.HYPERFRAMES_SKILL_PKG_VERSION}));`,
          { mode: 0o755 },
        );
        const run = (...args) => {
          const result = spawnSync(process.execPath, [launcher, ...args], {
            cwd,
            encoding: "utf8",
            env: { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
          });
          assert.equal(result.status, 0, result.stderr);
          return JSON.parse(result.stdout);
        };
        const withManifest = [run("--version"), run("skills", "update")];
        assert.equal(pluginVersion(root, cwd), undefined);
        assert.deepEqual(withManifest[0], { args: ["--yes", STANDALONE_CLI, "--version"] });
        rmSync(join(root, manifest));
        assert.deepEqual(withManifest, [run("--version"), run("skills", "update")]);
      },
    );
  }
}

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

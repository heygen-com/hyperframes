import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

function pluginShim(t) {
  const dir = mkdtempSync(join(tmpdir(), "hf-resolve-plugin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "lib"));
  for (const file of ["resolve.mjs", "lib/npx-sync.mjs", "lib/windows-exe-search.mjs"]) {
    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(dir, file));
  }
  const marker = join(dir, "npx-ran");
  writeFileSync(join(dir, "npx"), `#!/bin/sh\ntouch "${marker}"\nexit 9\n`, { mode: 0o755 });
  const run = (env) =>
    spawnSync(process.execPath, [join(dir, "resolve.mjs"), "--intent", "a & b"], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}${delimiter}${process.env.PATH}`,
        HYPERFRAMES_PLUGIN_VERSION: "1.2.3",
        HYPERFRAMES_SKIP_SKILLS: "1",
        HYPERFRAMES_CLI_ENTRY: "",
        ...env,
      },
    });
  return { dir, marker, run };
}

test(
  "plugin resolver runs the CLI the launcher handed over, not npx in the project",
  { skip: process.platform === "win32" },
  (t) => {
    const { dir, marker, run } = pluginShim(t);
    const launcher = join(dir, "launcher.mjs");
    writeFileSync(
      launcher,
      "console.log(JSON.stringify({args:process.argv.slice(2),skip:process.env.HYPERFRAMES_SKIP_SKILLS}));process.exit(7);",
    );
    const result = run({ HYPERFRAMES_CLI_ENTRY: launcher });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["media-use", "resolve", "--intent", "a & b"],
      skip: "1",
    });
    assert.equal(existsSync(marker), false);
  },
);

test(
  "plugin resolver without a handed-over CLI fails with the fix",
  { skip: process.platform === "win32" },
  (t) => {
    const { marker, run } = pluginShim(t);
    const result = run({});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /plugin-cli\.mjs --script/);
    assert.equal(existsSync(marker), false);
  },
);

test("helper package override keeps a contributor's local CLI", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hf-resolve-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, "skills/media-use/scripts");
  mkdirSync(join(scripts, "lib"), { recursive: true });
  mkdirSync(join(root, "packages/cli/dist"), { recursive: true });
  for (const file of ["resolve.mjs", "lib/npx-sync.mjs", "lib/windows-exe-search.mjs"]) {
    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(scripts, file));
  }
  writeFileSync(join(root, "packages/cli/dist/cli.js"), 'console.log("local-cli");');
  const result = spawnSync(process.execPath, [join(scripts, "resolve.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      HYPERFRAMES_PLUGIN_VERSION: "",
      HYPERFRAMES_SKILL_PKG_VERSION: "0.8.79",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "local-cli");
});

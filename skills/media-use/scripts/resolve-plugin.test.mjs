import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test(
  "plugin resolver uses the release CLI without a repository checkout",
  { skip: process.platform === "win32" },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-resolve-plugin-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "lib"));
    for (const file of ["resolve.mjs", "lib/npx-sync.mjs"]) {
      copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(dir, file));
    }
    writeFileSync(
      join(dir, "npx"),
      `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),skip:process.env.HYPERFRAMES_SKIP_SKILLS}));process.exit(7);`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [join(dir, "resolve.mjs"), "--intent", "a & b"], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}${delimiter}${process.env.PATH}`,
        HYPERFRAMES_PLUGIN_VERSION: "1.2.3",
        HYPERFRAMES_SKIP_SKILLS: "1",
      },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["--yes", "hyperframes@1.2.3", "media-use", "resolve", "--intent", "a & b"],
      skip: "1",
    });
  },
);

test("helper package override keeps a contributor's local CLI", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hf-resolve-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, "skills/media-use/scripts");
  mkdirSync(join(scripts, "lib"), { recursive: true });
  mkdirSync(join(root, "packages/cli/dist"), { recursive: true });
  for (const file of ["resolve.mjs", "lib/npx-sync.mjs"]) {
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";

const VAR = "NoDefaultCurrentDirectoryInExePath";
const here = dirname(fileURLToPath(import.meta.url));
const skillsRoot = resolve(here, "../../..");
const guards = ["hyperframes/scripts/lib", "media-use/scripts/lib", "figma/scripts/lib"].map(
  (dir) => join(skillsRoot, dir, "windows-exe-search.mjs"),
);
const realPlatform = process.platform;
const realValue = process.env[VAR];
const realPath = process.env.PATH;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  if (realValue === undefined) delete process.env[VAR];
  else process.env[VAR] = realValue;
  if (realPath === undefined) delete process.env.PATH;
  else process.env.PATH = realPath;
});

async function loadAs(platform, value, path = realPath) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  if (path === undefined) delete process.env.PATH;
  else process.env.PATH = path;
  await import(`${pathToFileURL(guards[0]).href}?load=${randomUUID()}`);
  return process.env[VAR];
}

test("every skill ships the same guard", () => {
  const [first, ...rest] = guards.map((file) => readFileSync(file, "utf8"));
  for (const copy of rest) assert.equal(copy, first);
});

test("turns off the working-directory program lookup on Windows", async () => {
  assert.equal(await loadAs("win32", undefined), "1");
});

test("keeps a value the person set", async () => {
  assert.equal(await loadAs("win32", "yes"), "yes");
});

test("leaves the Windows variable unset on other platforms", async () => {
  assert.equal(await loadAs("linux", undefined), undefined);
});

test("drops relative and empty PATH entries elsewhere and keeps absolute ones in order", async () => {
  await loadAs(
    "linux",
    undefined,
    ["", "node_modules/.bin", "/opt/b", ".", "~/bin", "/usr/bin", ""].join(":"),
  );
  assert.equal(process.env.PATH, "/opt/b:/usr/bin");
});

test("leaves PATH unset rather than empty when no entry is absolute", async () => {
  await loadAs("darwin", undefined, "node_modules/.bin::.");
  assert.equal(process.env.PATH, undefined);
});

test("keeps Windows PATH as it is", async () => {
  await loadAs("win32", undefined, "bin;C:\\tools");
  assert.equal(process.env.PATH, "bin;C:\\tools");
});

test(
  "a relative PATH entry cannot run a program planted in the project",
  { skip: process.platform === "win32" },
  (t) => {
    const project = mkdtempSync(join(tmpdir(), "hf-exe-search-"));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const marker = join(project, "planted-ran");
    mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
    const planted = join(project, "node_modules", ".bin", "ffprobe");
    writeFileSync(planted, `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(planted, 0o755);
    const script = 'require("node:child_process").spawnSync("ffprobe", ["-version"]);';
    const run = (guard) =>
      spawnSync(
        process.execPath,
        [...(guard ? ["--import", pathToFileURL(guards[0]).href] : []), "-e", script],
        { cwd: project, env: { ...process.env, PATH: `node_modules/.bin:${process.env.PATH}` } },
      );

    run(false);
    assert.ok(existsSync(marker), "the fixture must reach the planted program without the guard");
    rmSync(marker);
    run(true);
    assert.equal(existsSync(marker), false);
  },
);

function readdirTree(dir, pattern) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : readdirTree(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

function scripts(dir) {
  return readdirTree(dir, /\.mjs$/).filter((file) => !/\.test\.mjs$/.test(file));
}

test("every skill Python script that starts programs resolves them through trusted_program", () => {
  const starters = readdirTree(skillsRoot, /\.py$/).filter((file) =>
    /^(import subprocess|from subprocess import)/m.test(readFileSync(file, "utf8")),
  );
  assert.ok(starters.length > 0, "must inspect the Python scripts that start programs");
  const missing = starters
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      const resolver = join(dirname(file), "trusted_program.py");
      return !/^from trusted_program import find_program$/m.test(source) || !existsSync(resolver);
    })
    .map((file) => relative(skillsRoot, file));
  assert.deepEqual(missing, []);
});

test("every skill script that starts programs loads the guard before its other imports", () => {
  const starters = scripts(skillsRoot).filter((file) =>
    /from "(node:)?child_process"/.test(readFileSync(file, "utf8")),
  );
  assert.ok(starters.length > 10, "must inspect the scripts that start programs");
  const missing = starters
    .filter((file) => {
      const firstImport = readFileSync(file, "utf8").match(/^import [^\n]*$/m)?.[0] ?? "";
      return !/^import "[./]+(scripts\/)?(lib\/)?windows-exe-search\.mjs";$/.test(firstImport);
    })
    .map((file) => relative(skillsRoot, file));
  assert.deepEqual(missing, []);
});

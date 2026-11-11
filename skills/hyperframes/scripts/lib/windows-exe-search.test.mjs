import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  if (realValue === undefined) delete process.env[VAR];
  else process.env[VAR] = realValue;
});

async function loadAs(platform, value) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
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

test("leaves other platforms alone", async () => {
  assert.equal(await loadAs("linux", undefined), undefined);
});

function scripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : scripts(path);
    return /\.mjs$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name) ? [path] : [];
  });
}

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

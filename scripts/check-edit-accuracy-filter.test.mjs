import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";

// The edit accuracy bench is skipped when its path filter matches nothing, so every repo file the
// bench runs, imports or is built from must be in that filter, or a change to it skips the gate.
const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const isFile = (path) => existsSync(join(REPO, path)) && statSync(join(REPO, path)).isFile();
const ci = read(".github/workflows/ci.yml");
const BENCH = "packages/studio/tests/e2e/edit-accuracy";

function job(name) {
  const start = ci.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `job ${name} not found`);
  const rest = ci.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

function filterGlobs() {
  const block = ci.match(/\n {12}edit_accuracy:\n((?: {14}- .*\n)+)/);
  assert.ok(block, "edit_accuracy filter not found");
  return [...block[1].matchAll(/- "(.*)"/g)].map((m) => m[1]);
}

// Matches a path the way dorny/paths-filter does with `predicate-quantifier: some-with-excludes`.
function matcher(globs) {
  const all = globs.map((glob) => picomatch(glob, { dot: true }, true));
  const include = all.filter((m) => !m.state.negated);
  const exclude = all.filter((m) => m.state.negated);
  return (path) => include.some((m) => m(path)) && exclude.every((m) => m(path));
}

const PACKAGES = new Map(
  readdirSync(join(REPO, "packages"))
    .filter((dir) => isFile(`packages/${dir}/package.json`))
    .map((dir) => [JSON.parse(read(`packages/${dir}/package.json`)).name, `packages/${dir}`]),
);
const BUILT = /(?:^|\/)(?:dist|node_modules)\//;
const SOURCE = /\.(?:[cm]?[jt]sx?|html)$/;
const COMMENT = /\/\*[\s\S]*?\*\/|(^|[^:\w"'`])\/\/.*$/gm;
const TYPE_ONLY = /^\s*(?:import|export) type\b[^;]*;/gm;
const SPECIFIER = /(?:\bfrom|\bimport\(?|\brequire\(|new URL\(|\bsrc=)\s*["'`]([^"'`]+)["'`]/g;
const PATH_LITERAL = /["'`]((?:\.{1,2}\/)*[\w@-][\w.@-]*(?:\/[\w.@-]+)+)["'`]/g;
const TOOL_INPUTS = { tsup: ["tsup.config.ts"], vite: ["vite.config.ts", "index.html"] };
// cli.ts lazy-loads every command; only the commands the bench runs are followed.
const LAZY_COMMANDS = { file: "packages/cli/src/cli.ts", specifier: /^\.\/commands\// };

const RUN_SCRIPT = /^bun run (?:--cwd (\S+) )?(?:--filter '?([^' ]+)'? )?([\w:-]+)$/;
const INSTALL = /bun (?:install|run)\b|install-workspace-dependencies/;

const packageOf = (path) => path.match(/^packages\/[^/]+/)?.[0] ?? "";
const scriptsOf = (dir) => JSON.parse(read(repoPath(dir, "package.json"))).scripts ?? {};

function repoPath(...parts) {
  const path = posix.join(...parts);
  return path === "." ? "" : path;
}

function resolveFile(base) {
  const stem = base.replace(/\.[cm]?js$/, "");
  const candidates = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${base}.ts`, `${base}.js`];
  return [...candidates, `${base}/index.ts`, `${base}/index.js`].find(isFile);
}

function exportTargets(entry) {
  if (typeof entry === "string") return [entry];
  return Object.values(entry ?? {}).flatMap(exportTargets);
}

function exportEntry(manifest, subpath) {
  const main = subpath === "." ? manifest.main : undefined;
  return manifest.exports?.[subpath] ?? main;
}

// A workspace import resolves to the source its package exports; built output is covered by the
// package's own build, which `reach` follows.
function resolveWorkspace(specifier) {
  const name = specifier.split("/").slice(0, 2).join("/");
  const dir = PACKAGES.get(name);
  if (!dir) return [];
  const manifest = JSON.parse(read(`${dir}/package.json`));
  const entry = exportEntry(manifest, `.${specifier.slice(name.length)}`);
  return [`${dir}/package.json`, ...exportTargets(entry).map((target) => posix.join(dir, target))];
}

function resolveSpecifier(from, specifier) {
  const bare = specifier.split("?")[0];
  if (bare.startsWith("@hyperframes/")) return resolveWorkspace(bare);
  if (bare.startsWith("/")) return [resolveFile(posix.join(packageOf(from), bare))];
  if (!bare.startsWith(".")) return [];
  return [resolveFile(posix.join(posix.dirname(from), bare))];
}

function imports(path) {
  const text = read(path).replace(COMMENT, "$1").replace(TYPE_ONLY, "");
  const lazy = path === LAZY_COMMANDS.file ? LAZY_COMMANDS.specifier : null;
  return [...text.matchAll(SPECIFIER)]
    .map((m) => m[1])
    .filter((specifier) => !lazy?.test(specifier))
    .flatMap((specifier) => resolveSpecifier(path, specifier));
}

// Files a build script names as string literals, such as the stub it compiles.
function namedFiles(path) {
  const roots = [posix.dirname(path), packageOf(path), ""];
  return [...read(path).matchAll(PATH_LITERAL)].flatMap((m) =>
    roots.map((root) => repoPath(root, m[1])).filter(isFile),
  );
}

// A file leads to the files it imports, and a file a script runs also to the files it names.
const references = (path, entry) => [
  ...(SOURCE.test(path) ? imports(path) : []),
  ...(entry ? namedFiles(path) : []),
];

function tsconfigs(path) {
  if (!isFile(path)) return [];
  const parent = read(path).match(/"extends":\s*"(\.[^"]+)"/)?.[1];
  return parent ? [path, ...tsconfigs(posix.join(posix.dirname(path), parent))] : [path];
}

class Closure {
  files = new Set();
  packages = new Set();
  scripts = new Set();

  isNew(path) {
    return Boolean(path) && !this.files.has(path) && !BUILT.test(path) && isFile(path);
  }

  add(path, entry = false) {
    if (!this.isNew(path)) return;
    this.files.add(path);
    this.reach(packageOf(path));
    for (const next of references(path, entry)) this.add(next);
  }

  // The build job builds every package, but only the build of a package the bench reaches can change it.
  reach(dir) {
    if (!dir || this.packages.has(dir)) return;
    this.packages.add(dir);
    this.add(`${dir}/package.json`);
    tsconfigs(`${dir}/tsconfig.json`).forEach((path) => this.add(path));
    if (scriptsOf(dir).build) this.script(dir, "build");
  }

  script(dir, name) {
    const key = `${dir}#${name}`;
    if (this.scripts.has(key)) return;
    this.scripts.add(key);
    this.add(repoPath(dir, "package.json"));
    const command = scriptsOf(dir)[name];
    assert.ok(command, `${dir || "root"} has no script ${name}`);
    for (const part of command.split(/\s*(?:&&|\|\||;)\s*/)) this.command(dir, part);
  }

  command(dir, command) {
    const words = command.split(/\s+/).filter((word) => !/^\w+=/.test(word));
    const run = words.join(" ").match(RUN_SCRIPT);
    if (run) return this.runs(repoPath(dir, run[1] ?? "."), run[2], run[3]);
    this.tool(dir, words);
  }

  // A tool's own config, then every file named on its command line.
  tool(dir, words) {
    for (const input of TOOL_INPUTS[words[0]] ?? []) this.add(posix.join(dir, input));
    for (const word of words) this.add(posix.join(dir, word), true);
  }

  runs(dir, filter, name) {
    if (!filter) return this.script(dir, name);
    const selected = picomatch(filter);
    for (const [pkg, pkgDir] of PACKAGES) if (selected(pkg)) this.script(pkgDir, name);
  }
}

// A shell script a step runs is read like a step: the scripts and commands it runs count too.
function seedRun(closure, path) {
  const fresh = closure.isNew(path);
  closure.add(path, true);
  if (fresh && path.endsWith(".sh")) seed(closure, read(path));
}

// Repo files and package scripts the jobs' steps name directly.
function seed(closure, text) {
  for (const m of text.matchAll(/uses: \.\/(\S+)/g)) closure.add(`${m[1]}/action.yml`);
  for (const m of text.matchAll(/\b(?:bash|sh|node|bun) ((?:scripts|packages)\/\S+)/g))
    seedRun(closure, m[1]);
  for (const m of text.matchAll(/\bbun run --cwd (\S+) ([\w:-]+)/g)) closure.script(m[1], m[2]);
}

// The bench drives Studio through the built CLI, as `node cli.js <command>`.
const cliCommands = (texts) =>
  texts.flatMap((text) =>
    [...text.matchAll(/\bcli\.js (\w+)|\[cli, "(\w+)"/g)].map((m) => m[1] ?? m[2]),
  );

function benchInputs() {
  const closure = new Closure();
  const steps = [
    "edit-accuracy-cli",
    "studio-edit-accuracy",
    "studio-edit-accuracy-retry",
    "studio-edit-accuracy-gate",
  ].map(job);
  steps.forEach((text) => seed(closure, text));
  for (const name of cliCommands([...steps, read(`${BENCH}/case.mjs`)]))
    closure.add(`packages/cli/src/commands/${name}.ts`);
  closure.add("packages/cli/src/cli.ts");
  if (steps.some((text) => INSTALL.test(text)))
    ["package.json", "bun.lock"].forEach((path) => closure.add(path));
  return [...closure.files].sort();
}

test("the edit accuracy filter covers every file the bench runs, imports or is built from", () => {
  const inputs = benchInputs();
  for (const path of [
    `${BENCH}/run.mjs`,
    `${BENCH}/ratchet.mjs`,
    "scripts/ci/install-workspace-dependencies.sh",
    "packages/cli/src/commands/preview.ts",
    "packages/producer/src/services/frameCapture.ts",
    "packages/producer/scripts/build-hf-early-stub.ts",
    "packages/producer/stubs/hf-early-stub.ts",
  ])
    assert.ok(inputs.includes(path), `${path} should be a bench input`);
  const covered = matcher(filterGlobs());
  assert.deepEqual(
    inputs.filter((path) => !covered(path)),
    [],
  );
});

test("the filter keeps the root manifest, lockfile and install script, and drops tests and docs", () => {
  const covered = matcher(filterGlobs());
  for (const path of [
    "package.json",
    "bun.lock",
    "scripts/ci/install-workspace-dependencies.sh",
    ".github/actions/prepare-ffmpeg-bin/action.yml",
    "packages/studio/src/App.tsx",
    "packages/producer/src/services/frameCapture.ts",
    "packages/producer/scripts/build-hf-early-stub.ts",
    "packages/producer/stubs/hf-early-stub.ts",
  ])
    assert.ok(covered(path), `${path} should run the bench`);
  for (const path of [
    "packages/studio/src/App.test.tsx",
    "packages/core/src/README.md",
    "docs/index.mdx",
  ])
    assert.ok(!covered(path), `${path} should not run the bench`);
});

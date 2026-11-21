#!/usr/bin/env node
// sealed-parity.mjs check | run <mode> <out> | compare <unsealed> <sealed> <out> | gate <parity.json>
// Every behaviour in packages/studio/tests/sealed-parity/manifest.json must pass the same tests with the preview
// sealed and unsealed before the preview can be sealed by default. See manifest.json for the row format.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = "packages/studio/tests/sealed-parity/manifest.json";
export const MODES = ["unsealed", "sealed"];

// Where the code reads each default. A source that stops matching fails the gate, so no refactor hides a flip.
export const DEFAULT_READERS = [
  {
    surface: "Studio preview",
    file: "packages/studio/src/components/editor/manualEditingAvailability.ts",
    pattern:
      /STUDIO_OPAQUE_PREVIEW_ENABLED = resolveStudioBooleanEnvFlag\(\s*env,\s*\[[^\]]*\],\s*(true|false)\s*,?\s*\)/,
  },
];

export function readManifest(text) {
  const rows = JSON.parse(text).rows ?? [];
  const seen = new Set();
  const problems = rows.flatMap((row) => {
    const repeated = seen.has(row.id) ? [`row ${row.id} is listed twice`] : [];
    seen.add(row.id);
    return [...rowProblems(row), ...repeated];
  });
  return { rows, problems };
}

function rowProblems(row) {
  const own =
    row.id && row.behaviour ? [] : [`a row needs an id and a behaviour: ${JSON.stringify(row)}`];
  return [...own, ...(row.tests ?? []).flatMap((test) => testProblems(row.id, test))];
}

function testProblems(id, test) {
  const problems = [];
  if (test.kind !== "vitest") problems.push(`row ${id}: unknown test kind ${test.kind}`);
  if (!test.package || !test.file) problems.push(`row ${id}: a test needs a package and a file`);
  return problems;
}

export function checkFiles(rows, exists) {
  const problems = [];
  for (const row of rows)
    for (const test of row.tests ?? []) {
      const path = join("packages", test.package, test.file);
      if (!exists(path)) problems.push(`row ${row.id}: ${path} does not exist`);
    }
  return problems;
}

/** One mode's vitest JSON report, reduced to the verdict of each test the manifest names. */
export function verdicts(rows, report) {
  const byFile = new Map();
  for (const file of report.testResults ?? [])
    byFile.set(file.name.replace(/\\/g, "/"), file.assertionResults ?? []);
  const out = {};
  for (const row of rows)
    for (const test of row.tests ?? []) {
      const suffix = `/packages/${test.package}/${test.file}`;
      const results = [...byFile].find(([name]) => name.endsWith(suffix))?.[1];
      const named = (results ?? []).filter(
        (r) => !test.name || r.fullName === test.name || r.fullName.startsWith(`${test.name} `),
      );
      out[testKey(test)] = verdictOf(named.map((r) => r.status));
    }
  return out;
}

/** Vitest marks a test that did not run as skipped, pending or todo; all three count as skipped. */
function verdictOf(statuses) {
  if (statuses.length === 0) return "missing";
  if (statuses.every((status) => status === "passed")) return "passed";
  if (statuses.includes("failed")) return "failed";
  return "skipped";
}

export function testKey(test) {
  return `${test.package}/${test.file}${test.name ? ` > ${test.name}` : ""}`;
}

/** A row passes only when it has a test and every test passed in both modes. */
export function compare(rows, unsealed, sealed) {
  return rows.map((row) => {
    const tests = (row.tests ?? []).map((test) => {
      const key = testKey(test);
      return { test: key, unsealed: unsealed[key] ?? "missing", sealed: sealed[key] ?? "missing" };
    });
    return { id: row.id, behaviour: row.behaviour, verdict: rowVerdict(tests), tests };
  });
}

function rowVerdict(tests) {
  if (tests.length === 0) return "no test";
  return tests.every((t) => t.unsealed === "passed" && t.sealed === "passed")
    ? "parity"
    : "differs";
}

/** Problems that fail CI whatever the default: a listed test that did not run, or was skipped, in either mode. */
export function unranTests(parity) {
  return parity.flatMap((row) =>
    row.tests
      .filter((t) => [t.unsealed, t.sealed].some((v) => v === "missing" || v === "skipped"))
      .map(
        (t) => `row ${row.id}: ${t.test} was ${t.unsealed === "passed" ? t.sealed : t.unsealed}`,
      ),
  );
}

export function sealedDefaults(read) {
  return DEFAULT_READERS.map(({ surface, file, pattern }) => {
    const match = pattern.exec(read(file));
    return { surface, file, sealed: match ? match[1] === "true" : null };
  });
}

export function gate(parity, defaults) {
  const unreadable = defaults.filter((d) => d.sealed === null);
  if (unreadable.length > 0)
    return {
      ok: false,
      lines: unreadable.map((d) => `cannot read the ${d.surface} default in ${d.file}`),
    };
  const sealed = defaults.filter((d) => d.sealed);
  const failing = parity.filter((row) => row.verdict !== "parity");
  const lines = [`${parity.length - failing.length} of ${parity.length} behaviours at parity`];
  for (const row of failing) lines.push(`  ${row.verdict}: ${row.id} (${row.behaviour})`);
  if (sealed.length === 0)
    return { ok: true, lines: [...lines, "every default is unsealed: nothing to refuse"] };
  const names = sealed.map((d) => d.surface).join(", ");
  if (failing.length === 0)
    return { ok: true, lines: [...lines, `${names} sealed by default, every behaviour at parity`] };
  return {
    ok: false,
    lines: [...lines, `refused: ${names} sealed by default before every behaviour is at parity`],
  };
}

function readRepo(path) {
  return readFileSync(join(REPO, path), "utf8");
}

/** Each package's listed test files, once each: one test runner call per package. */
export function filesByPackage(rows) {
  const byPackage = new Map();
  for (const test of rows.flatMap((row) => row.tests ?? []))
    byPackage.set(test.package, new Set([...(byPackage.get(test.package) ?? []), test.file]));
  return byPackage;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function report(lines, stream, ok) {
  for (const line of lines) stream(line);
  return ok ? 0 : 1;
}

function check(rows, problems) {
  const all = [...problems, ...checkFiles(rows, (p) => existsSync(join(REPO, p)))];
  console.log(
    `${rows.length} behaviours, ${rows.filter((r) => !r.tests?.length).length} without a test yet`,
  );
  return report(all, console.error, all.length === 0);
}

function runMode(rows, [mode, out]) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
  const results = { testResults: [] };
  for (const [pkg, files] of filesByPackage(rows)) {
    const json = join(tmpdir(), `sealed-parity-${pkg}-${mode}.json`);
    rmSync(json, { force: true });
    spawnSync("bunx", ["vitest", "run", ...files, "--reporter=json", `--outputFile=${json}`], {
      cwd: join(REPO, "packages", pkg),
      env: { ...process.env, HF_PARITY_MODE: mode },
      stdio: "inherit",
    });
    if (existsSync(json)) results.testResults.push(...readJson(json).testResults);
  }
  writeFileSync(out, JSON.stringify(verdicts(rows, results), null, 2));
  return 0;
}

function compareModes(rows, [unsealed, sealed, out]) {
  const parity = compare(rows, readJson(unsealed), readJson(sealed));
  writeFileSync(out, JSON.stringify(parity, null, 2));
  const unran = unranTests(parity);
  return report(unran, console.error, unran.length === 0);
}

function gateDefaults(_rows, [parityFile]) {
  const result = gate(readJson(parityFile), sealedDefaults(readRepo));
  return report(result.lines, console.log, result.ok);
}

const COMMANDS = { run: runMode, compare: compareModes, gate: gateDefaults };

function main([command, ...args]) {
  const { rows, problems } = readManifest(readRepo(MANIFEST));
  if (command === "check") return check(rows, problems);
  if (Object.hasOwn(COMMANDS, command)) return COMMANDS[command](rows, args);
  console.error(
    "usage: sealed-parity.mjs check | run <mode> <out> | compare <unsealed> <sealed> <out> | gate <parity>",
  );
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

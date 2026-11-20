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
  const manifest = JSON.parse(text);
  const problems = [];
  const ids = new Set();
  for (const row of manifest.rows ?? []) {
    if (!row.id || !row.behaviour)
      problems.push(`a row needs an id and a behaviour: ${JSON.stringify(row)}`);
    if (ids.has(row.id)) problems.push(`row ${row.id} is listed twice`);
    ids.add(row.id);
    for (const test of row.tests ?? []) {
      if (test.kind !== "vitest") problems.push(`row ${row.id}: unknown test kind ${test.kind}`);
      if (!test.package || !test.file)
        problems.push(`row ${row.id}: a test needs a package and a file`);
    }
  }
  return { rows: manifest.rows ?? [], problems };
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

function main([command, ...args]) {
  const { rows, problems } = readManifest(readRepo(MANIFEST));
  if (command === "check") {
    const all = [...problems, ...checkFiles(rows, (p) => existsSync(join(REPO, p)))];
    for (const line of all) console.error(line);
    console.log(
      `${rows.length} behaviours, ${rows.filter((r) => !r.tests?.length).length} without a test yet`,
    );
    return all.length === 0 ? 0 : 1;
  }
  if (command === "run") {
    const [mode, out] = args;
    if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
    const byPackage = new Map();
    for (const row of rows)
      for (const t of row.tests ?? [])
        byPackage.set(t.package, [...(byPackage.get(t.package) ?? []), t.file]);
    const report = { testResults: [] };
    for (const [pkg, files] of byPackage) {
      const json = join(tmpdir(), `sealed-parity-${pkg}-${mode}.json`);
      rmSync(json, { force: true });
      spawnSync(
        "bunx",
        ["vitest", "run", ...new Set(files), "--reporter=json", `--outputFile=${json}`],
        {
          cwd: join(REPO, "packages", pkg),
          env: { ...process.env, HF_PARITY_MODE: mode },
          stdio: "inherit",
        },
      );
      if (existsSync(json))
        report.testResults.push(...JSON.parse(readFileSync(json, "utf8")).testResults);
    }
    writeFileSync(out, JSON.stringify(verdicts(rows, report), null, 2));
    return 0;
  }
  if (command === "compare") {
    const [unsealed, sealed, out] = args;
    const parity = compare(
      rows,
      JSON.parse(readFileSync(unsealed, "utf8")),
      JSON.parse(readFileSync(sealed, "utf8")),
    );
    writeFileSync(out, JSON.stringify(parity, null, 2));
    const unran = unranTests(parity);
    for (const line of unran) console.error(line);
    return unran.length === 0 ? 0 : 1;
  }
  if (command === "gate") {
    const result = gate(JSON.parse(readFileSync(args[0], "utf8")), sealedDefaults(readRepo));
    for (const line of result.lines) console.log(line);
    return result.ok ? 0 : 1;
  }
  console.error(
    "usage: sealed-parity.mjs check | run <mode> <out.json> | compare <unsealed.json> <sealed.json> <out.json> | gate <parity.json>",
  );
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

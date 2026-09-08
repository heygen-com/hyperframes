/**
 * The React Compiler bail-out scan.
 *
 * `react({ compiler: true })` compiles what it can and silently emits the rest
 * as written, so a component that opts itself out costs nothing visible. This
 * turns that silence into a number per file, which `compilerBailouts.test.ts`
 * ratchets.
 *
 * Three facts about `oxc-transform-react` 0.149.0 that shape the code below,
 * each measured against this version rather than read from a doc:
 *
 * 1. There is no non-fatal diagnostic channel. `outputMode: "lint"` with the
 *    default `panicThreshold` returns zero errors even for a component written
 *    to violate the rules of React. Escalating `panicThreshold` to
 *    `"all_errors"` is the only way a skip surfaces.
 * 2. That escalation reports every diagnostic inside the FIRST function it
 *    declines and then aborts the module, so the second declined function in a
 *    file is invisible until the first is fixed. See the ceiling note on
 *    `analyzeSource`.
 * 3. A `"use no memo"` / `"use no forget"` directive is honoured before any
 *    diagnostic is produced, so the compiler never reports it at all. It is
 *    counted from the source text instead. A `react-hooks` suppression is the
 *    opposite: the compiler already reports it as "React rule suppression
 *    prevents optimization", so counting those separately would double count.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "oxc-transform-react";

/** @typedef {{ readonly count: number, readonly causes: readonly string[] }} FileBailouts */

export const STUDIO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

const SRC = "src";

/** Directive prologue that opts a function out. Its own statement, so anchored. */
const OPT_OUT_DIRECTIVE = /^[ \t]*(["'])(use no (?:memo|forget))\1[ \t]*;?[ \t]*$/gm;

const SKIPPED_DIRS = new Set(["node_modules", "dist", "__snapshots__"]);

/**
 * @param {string} relative Studio-relative, POSIX separators.
 * @returns {boolean}
 */
export function isScanned(relative) {
  if (!relative.startsWith(`${SRC}/`)) return false;
  if (!/\.tsx?$/.test(relative)) return false;
  if (/\.d\.ts$/.test(relative)) return false;
  if (/\.(test|stories)\.tsx?$/.test(relative)) return false;
  return relative !== "src/test-setup.ts";
}

/**
 * Every scanned file under `src`, Studio-relative and sorted.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function listSourceFiles(root = STUDIO_ROOT) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} relativeDir */
  const walk = (relativeDir) => {
    for (const entry of readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(relative);
      } else if (isScanned(relative)) {
        files.push(relative);
      }
    }
  };
  walk(SRC);
  return files.sort();
}

/**
 * @param {string} relative
 * @returns {{ lang: "tsx" | "ts", sourceType: "module" }}
 */
function parseOptions(relative) {
  return { lang: relative.endsWith(".tsx") ? "tsx" : "ts", sourceType: "module" };
}

/**
 * The diagnostics oxc-transform-react reports for one module, escalated so a
 * skip is actually visible (see the module docstring, fact 1). Only the FIRST
 * declined function's diagnostics come back; the transform aborts the module
 * there. A parse failure is not a bail-out and throws instead of returning.
 *
 * @param {string} relative
 * @param {string} source
 * @param {{ lang: "tsx" | "ts", sourceType: "module" }} options
 * @returns {import("oxc-transform-react").OxcError[]}
 */
function escalatedErrors(relative, source, options) {
  const escalated = transformSync(path.basename(relative), source, {
    ...options,
    reactCompiler: { panicThreshold: "all_errors" },
  });
  if (escalated.errors.length === 0) return [];
  // A file that does not parse also lands here, and is not a bail-out. Only
  // the files that already errored pay for this second pass.
  const parsed = transformSync(path.basename(relative), source, {
    ...options,
    reactCompiler: false,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`${relative} does not parse: ${parsed.errors[0]?.message}`);
  }
  return escalated.errors;
}

/**
 * What the compiler declines to compile in one module.
 *
 * `count` is one per opt-out the scan can see: one per directive, plus one if
 * the compiler declines the file at all. It is deliberately NOT the number of
 * reported diagnostics.
 *
 * ponytail: the diagnostic count is not monotone and a ratchet needs monotone.
 * Escalating `panicThreshold` yields every diagnostic inside the first declined
 * function and then aborts the module, so `App.tsx` reports 21 ref reads from
 * one function while a second declined function further down reports nothing.
 * Fixing that first function would UNCOVER the second and the count could go up
 * while the code got better, which is a gate that cries wolf. One per file is
 * monotone: it catches every file going 0 -> 1, and once a file is at 0 it is
 * exact. The hole it accepts is a second bail-out added to a file that already
 * bails. Upgrade path: a true per-function count needs oxc to expose non-fatal
 * diagnostics, not a cleverer caller.
 *
 * @param {string} relative
 * @param {string} source
 * @returns {FileBailouts}
 */
export function analyzeSource(relative, source) {
  /** @type {string[]} */
  const causes = [];
  for (const match of source.matchAll(OPT_OUT_DIRECTIVE)) causes.push(`"${match[2]}" directive`);
  let count = causes.length;

  const errors = escalatedErrors(relative, source, parseOptions(relative));
  if (errors.length > 0) {
    count += 1;
    for (const error of errors) {
      if (!causes.includes(error.message)) causes.push(error.message);
    }
  }

  return { count, causes };
}

/** @typedef {{ readonly file: string, readonly cause: string, readonly codeframe: string }} Frame */

/**
 * Every diagnostic oxc-transform-react reports for the given files, one entry
 * per diagnostic and NOT deduped by cause (unlike `causes` above), so two ref
 * reads in the same function both get their own line and caret.
 *
 * Only the first declined function per module has anything to show here; see
 * the ceiling note on `analyzeSource`. A `"use no memo"` / `"use no forget"`
 * directive opts out before any diagnostic is produced, so it never appears
 * in this list either, only in `analyzeSource`'s count.
 *
 * @param {readonly string[]} files Studio-relative, POSIX separators.
 * @param {string} [root]
 * @returns {Frame[]}
 */
export function collectFrames(files, root = STUDIO_ROOT) {
  /** @type {Frame[]} */
  const frames = [];
  for (const relative of files) {
    const source = readFileSync(path.join(root, relative), "utf8");
    for (const error of escalatedErrors(relative, source, parseOptions(relative))) {
      if (error.codeframe)
        frames.push({ file: relative, cause: error.message, codeframe: error.codeframe });
    }
  }
  return frames;
}

/**
 * Turn `--frames` arguments (files or directories, relative to cwd or
 * absolute) into scanned Studio-relative file paths. No arguments scans
 * everything `listSourceFiles` would.
 *
 * @param {readonly string[]} args
 * @param {string} [root]
 * @returns {string[]}
 */
export function resolveScanTargets(args, root = STUDIO_ROOT) {
  const all = listSourceFiles(root);
  if (args.length === 0) return all;
  const targets = args.map((arg) =>
    path.relative(root, path.resolve(arg)).split(path.sep).join("/"),
  );
  return all.filter((file) =>
    targets.some((target) => file === target || file.startsWith(`${target}/`)),
  );
}

/**
 * @param {readonly Frame[]} frames
 * @returns {string}
 */
export function formatFrames(frames) {
  if (frames.length === 0)
    return "No React Compiler diagnostics with a codeframe in the given files.\n";
  return `${frames.map(({ file, cause, codeframe }) => `${file}: ${cause}${codeframe}`).join("\n")}\n`;
}

/**
 * @param {string} [root]
 * @returns {Map<string, FileBailouts>}
 */
export function scanTree(root = STUDIO_ROOT) {
  /** @type {Map<string, FileBailouts>} */
  const found = new Map();
  for (const relative of listSourceFiles(root)) {
    const bailouts = analyzeSource(relative, readFileSync(path.join(root, relative), "utf8"));
    if (bailouts.count > 0) found.set(relative, bailouts);
  }
  return found;
}

/**
 * @param {ReadonlyMap<string, FileBailouts>} found
 * @returns {Map<string, number>}
 */
export function toCounts(found) {
  return new Map([...found].map(([file, { count }]) => [file, count]));
}

/** @typedef {{ readonly total: number, readonly files: Readonly<Record<string, number>> }} Baseline */

/**
 * @param {ReadonlyMap<string, number>} counts
 * @returns {Baseline}
 */
export function toBaseline(counts) {
  /** @type {Record<string, number>} */
  const files = {};
  let total = 0;
  for (const file of [...counts.keys()].sort()) {
    files[file] = counts.get(file) ?? 0;
    total += files[file];
  }
  return { total, files };
}

/**
 * Every file whose count moved, split by direction.
 *
 * @param {ReadonlyMap<string, number>} counts
 * @param {Baseline} baseline
 */
function compare(counts, baseline) {
  /** @type {string[]} */
  const risen = [];
  /** @type {string[]} */
  const fallen = [];
  // A file the baseline has never seen has a baseline of zero, so a rename
  // cannot smuggle a bail-out past the ratchet.
  for (const [file, count] of counts) {
    const allowed = baseline.files[file] ?? 0;
    if (count > allowed) risen.push(`${file}: ${count} bail-outs, baseline ${allowed}`);
    if (count < allowed) fallen.push(`${file}: ${count}, baseline ${allowed}`);
  }
  for (const [file, allowed] of Object.entries(baseline.files)) {
    if (!counts.has(file)) fallen.push(`${file}: now 0, baseline ${allowed}`);
  }
  return { risen, fallen };
}

export const WRITE_FLAG = "COMPILER_BAILOUTS_WRITE";
export const LOWER_COMMAND = `${WRITE_FLAG}=1 bunx vitest run src/styles/compilerBailouts.test.ts`;
export const BASELINE_RELATIVE = "src/styles/compiler-bailouts.json";

/**
 * What the author has to hear. A rise is a failure. A fall is fine, and is
 * reported with the command that banks it, because a baseline left high is a
 * budget the next change can spend.
 *
 * @param {ReadonlyMap<string, number>} counts
 * @param {Baseline | undefined} baseline
 * @returns {string[]}
 */
export function verdict(counts, baseline) {
  if (baseline === undefined) {
    return [`${BASELINE_RELATIVE} is missing. Write it with: ${LOWER_COMMAND}`];
  }
  const { risen, fallen } = compare(counts, baseline);
  if (risen.length > 0) {
    return [
      "These files gained a React Compiler bail-out, so their components are no longer memoized.",
      ...risen,
      `Fix the bail-out; a directive or a react-hooks suppression counts too. If it is truly unavoidable: ${LOWER_COMMAND}`,
    ];
  }
  if (fallen.length > 0) return [`Bail-outs went down. Bank it: ${LOWER_COMMAND}`, ...fallen];
  return [];
}

/**
 * The grouped, human-facing report: causes largest group first, files sorted.
 *
 * @param {ReadonlyMap<string, FileBailouts>} found
 * @returns {string}
 */
export function formatReport(found) {
  /** @type {Map<string, string[]>} */
  const byCause = new Map();
  let total = 0;
  for (const [file, { count, causes }] of found) {
    total += count;
    for (const cause of causes) {
      const files = byCause.get(cause) ?? [];
      files.push(file);
      byCause.set(cause, files);
    }
  }
  const groups = [...byCause].sort(
    ([causeA, a], [causeB, b]) => b.length - a.length || causeA.localeCompare(causeB),
  );
  const lines = [
    `${found.size} of ${listSourceFiles().length} scanned files bail out of the React Compiler (${total} bail-outs).`,
  ];
  for (const [cause, files] of groups) {
    lines.push("", `${cause} (${files.length})`);
    for (const file of files.sort()) lines.push(`  ${file}`);
  }
  return `${lines.join("\n")}\n`;
}

const HELP = `Usage: compiler-bailouts.mjs [--json] [--frames [<file-or-dir>...]]

  (no flags)     Print the grouped, human-facing bail-out report.
  --json         Print the same scan as { total, files: { file: causes[] } } JSON.
  --frames       Print, for every React Compiler diagnostic, the file, the
                 cause, and oxc-transform-react's own codeframe (line, column,
                 caret), so an engineer lands on the exact statement.
                 Restrict the scan to the given files/dirs; scans everything
                 under src/ with no arguments. Only the FIRST declined
                 function per module is reported: escalating the compiler's
                 panic threshold aborts the module after its first bail-out,
                 so a second declined function further down stays invisible
                 until the first is fixed. A "use no memo" / "use no forget"
                 directive has no diagnostic to frame; it never appears here.
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
  } else if (argv.includes("--frames")) {
    const targets = resolveScanTargets(argv.slice(argv.indexOf("--frames") + 1));
    process.stdout.write(formatFrames(collectFrames(targets)));
  } else {
    const found = scanTree();
    const asJson = Object.fromEntries([...found].map(([file, { causes }]) => [file, causes]));
    process.stdout.write(
      argv.includes("--json")
        ? `${JSON.stringify({ total: toBaseline(toCounts(found)).total, files: asJson }, null, 2)}\n`
        : formatReport(found),
    );
  }
}

#!/usr/bin/env node
// motion-blur-nightly-report.mjs --failures <dir> --generated-result <result> --date <YYYY-MM-DD> ...
// Reads the nightly's per-job failure files and opens the issues, warnings and summary they call for.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACT_PREFIX = "blur-nightly-failures-";
const FILE = "blur-nightly-failures.json";
const LABELS = ["bug", "area/quality"];
const DETAILED_SEEDS = 50;
const MAX_PROBLEM_CHARS = 400;

export const DEFAULTS = { maxIssues: 25, systemicAbove: 5 };

const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}...` : text);

const escapeData = (text) =>
  String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const inertColons = (text) => text.replace(/:(?=:)/g, ": ");
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function workflowCommand(name, message, properties = {}) {
  const props = Object.entries(properties)
    .map(([key, value]) => `${key}=${escapeProperty(value)}`)
    .join(",");
  return `::${name}${props ? ` ${props}` : ""}::${inertColons(escapeData(message))}`;
}

const warning = (message) => workflowCommand("warning", message);

const inline = (text) =>
  `\`${String(text)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "'")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\|/g, "\\|")}\``;

function fenced(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return [ticks, text, ticks].join("\n");
}

const flavourList = (flavours) => [...new Set(flavours)].map(inline).join(", ");

function readFailureFile(file, flavour) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).map((record) => ({ ...record, flavour }));
  } catch (error) {
    return [{ seed: null, features: [], problems: [`unreadable ${file}: ${error}`], flavour }];
  }
}

export function readRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name, FILE);
    if (!name.startsWith(ARTIFACT_PREFIX) || !existsSync(file)) return [];
    return readFailureFile(file, name.slice(ARTIFACT_PREFIX.length).split("-")[0]);
  });
}

const isSeed = (seed) => Number.isSafeInteger(seed) && seed >= 0;

export function classify(records) {
  const failing = new Map();
  const unstable = [];
  const setup = [];
  for (const record of records) {
    const { flavour } = record;
    const problems = Array.isArray(record.problems) ? record.problems.map(String) : [];
    const features = Array.isArray(record.features) ? record.features.map(String) : [];
    if (record.seed === null || record.seed === undefined) {
      setup.push({ flavour, problems: problems.length ? problems : ["record without a seed"] });
    } else if (!isSeed(record.seed)) {
      setup.push({
        flavour,
        problems: [`record without a usable seed (${record.seed})`, ...problems],
      });
    } else if (problems.length > 0) {
      const entry = failing.get(record.seed) ?? {
        seed: record.seed,
        features,
        flavours: [],
        problems: [],
      };
      entry.flavours.push(flavour);
      entry.problems.push(...problems.map((problem) => `[${flavour}] ${problem}`));
      failing.set(record.seed, entry);
    } else if (typeof record.unstableReference === "number") {
      unstable.push({ seed: record.seed, features, flavour, mae: record.unstableReference });
    }
  }
  return {
    failing: [...failing.values()].sort((a, b) => a.seed - b.seed),
    unstable: unstable.sort((a, b) => a.seed - b.seed),
    setup,
  };
}

const seedTitle = (seed) => `motion blur nightly: seed ${seed}`;
const systemicTitle = (date) => `motion blur nightly: systemic failure ${date}`;
const features = (entry) => entry.features.join(", ") || "none";
const flavoursOf = (entries) => entries.flatMap((entry) => entry.flavours);

export function seedBody(entry, runUrl) {
  return [
    `Seed ${entry.seed} fails the pixel invariants on \`auto\`.`,
    "",
    `- Features: ${inline(features(entry))}`,
    `- Chrome flavours that failed: ${flavourList(entry.flavours)}`,
    `- Run: ${runUrl}`,
    "",
    "Reproduce from `packages/engine`:",
    "",
    "```sh",
    `HF_BLUR_SEEDS=${entry.seed} bunx vitest run --project browser src/services/captureMotionBlur.generated.browser.test.ts`,
    "```",
    "",
    "Findings, by flavour:",
    "",
    fenced(
      entry.problems
        .slice(0, 10)
        .map((problem) => clip(problem, MAX_PROBLEM_CHARS))
        .join("\n"),
    ),
  ].join("\n");
}

export function systemicBody(entries, date, runUrl) {
  const shown = entries.slice(0, DETAILED_SEEDS);
  const rest = entries.slice(DETAILED_SEEDS).map((entry) => entry.seed);
  const lines = shown.map(
    (entry) =>
      `${entry.seed} [${features(entry)}] (${[...new Set(entry.flavours)].join(", ")}): ${clip(entry.problems[0], 200)}`,
  );
  return [
    `${entries.length} seeds failed the pixel invariants on \`auto\` in the ${date} run, which points at one cause rather than ${entries.length} defects.`,
    "",
    `- Run: ${runUrl}`,
    `- Chrome flavours that failed: ${flavourList(flavoursOf(entries))}`,
    "",
    "Reproduce one from `packages/engine`:",
    "",
    "```sh",
    `HF_BLUR_SEEDS=${entries[0].seed} bunx vitest run --project browser src/services/captureMotionBlur.generated.browser.test.ts`,
    "```",
    "",
    "Seeds:",
    "",
    fenced(lines.join("\n")),
    ...(rest.length ? ["", `And ${rest.length} more: ${rest.join(", ")}`] : []),
  ].join("\n");
}

function openTitles(gh) {
  const result = gh([
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "title",
    "--jq",
    ".[].title",
  ]);
  if (result.status !== 0) throw new Error(`gh issue list failed: ${result.stderr}`);
  return new Set(result.stdout.split("\n").filter(Boolean));
}

function openIssue(gh, titles, title, body, log) {
  if (titles.has(title)) {
    log(`skipping "${title}": an open issue has that title`);
    return;
  }
  const file = join(mkdtempSync(join(tmpdir(), "blur-nightly-")), "body.md");
  writeFileSync(file, body);
  const labels = LABELS.flatMap((label) => ["--label", label]);
  const result = gh(["issue", "create", "--title", title, "--body-file", file, ...labels]);
  if (result.status !== 0)
    throw new Error(`gh issue create failed for "${title}": ${result.stderr}`);
  titles.add(title);
  log(`opened "${title}"`);
}

function fileIssues({ failing, gh, date, runUrl, maxIssues, systemicAbove, log }) {
  if (failing.length === 0) return;
  const titles = openTitles(gh);
  if (failing.length > systemicAbove) {
    openIssue(gh, titles, systemicTitle(date), systemicBody(failing, date, runUrl), log);
    return;
  }
  const entries = failing.slice(0, maxIssues);
  if (failing.length > entries.length)
    log(warning(`${failing.length} failing seeds; the first ${maxIssues} get an issue`));
  for (const entry of entries)
    openIssue(gh, titles, seedTitle(entry.seed), seedBody(entry, runUrl), log);
}

function summaryLines({ failing, unstable, setup, silentFailure }) {
  const lines = ["## Motion blur nightly", ""];
  if (silentFailure) {
    lines.push(
      `A generated job ended ${inline(silentFailure)} without recording a failing seed (a crash, a kill or a setup step); see the job logs.`,
      "",
    );
  }
  if (setup.length) {
    const items = setup.map(
      (item) => `${item.flavour}: ${item.problems.map((p) => clip(p, 300)).join("; ")}`,
    );
    lines.push(
      "### The run did not start or its record was unusable",
      "",
      fenced(items.join("\n")),
      "",
    );
  }
  if (failing.length) {
    const items = failing.map(
      (entry) => `${entry.seed} [${features(entry)}] on ${[...new Set(entry.flavours)].join(", ")}`,
    );
    lines.push("### Failing seeds", "", fenced(items.join("\n")), "");
  }
  if (unstable.length) {
    lines.push(
      "### Seeds whose blur-off reference disagreed with itself (renderer noise, no issue opened)",
      "",
      "| Seed | Features | Flavour | Worst blur-off MAE |",
      "| --- | --- | --- | --- |",
      ...unstable.map(
        (u) =>
          `| ${u.seed} | ${inline(u.features.join(", "))} | ${inline(u.flavour)} | ${u.mae.toFixed(2)} |`,
      ),
      "",
    );
  }
  if (lines.length === 2) lines.push("No failing and no unstable seeds.", "");
  return lines;
}

export function report(options) {
  const { dir, generatedResult, summaryFile, log } = options;
  const { failing, unstable, setup } = classify(readRecords(dir));
  const silentFailure =
    generatedResult !== "success" && failing.length === 0 && setup.length === 0
      ? generatedResult || "without a result"
      : "";
  if (silentFailure)
    log(
      warning(
        `A generated job ended ${silentFailure} without recording a failing seed; see the run logs.`,
      ),
    );
  if (setup.length) {
    const causes = setup.map((s) => `${s.flavour}: ${clip(s.problems[0], 200)}`).join(" | ");
    log(warning(`The nightly did not run cleanly: ${causes}`));
  }
  if (unstable.length) {
    const seeds = [...new Set(unstable.map((u) => u.seed))];
    log(
      warning(
        `${seeds.length} seed(s) had a blur-off reference that disagrees with itself and were not counted: ${seeds.join(", ")}`,
      ),
    );
  }
  if (summaryFile)
    appendFileSync(
      summaryFile,
      `${summaryLines({ failing, unstable, setup, silentFailure }).join("\n")}\n`,
    );
  fileIssues({ ...options, failing });
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 26 });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function readFlags(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) {
      throw new Error(`bad argument ${argv[i]}`);
    }
    values[argv[i].slice(2)] = argv[i + 1];
  }
  return values;
}

function parseArgs(argv) {
  const flags = {
    failures: "failures",
    "generated-result": "",
    "run-url": "",
    "max-issues": DEFAULTS.maxIssues,
    "systemic-above": DEFAULTS.systemicAbove,
    date: new Date().toISOString().slice(0, 10),
    ...readFlags(argv),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) throw new Error(`bad date ${flags.date}`);
  return {
    dir: flags.failures,
    generatedResult: flags["generated-result"],
    date: flags.date,
    runUrl: flags["run-url"],
    summaryFile: flags.summary,
    maxIssues: Number(flags["max-issues"]),
    systemicAbove: Number(flags["systemic-above"]),
    gh,
    log: (line) => console.log(line),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) report(parseArgs(process.argv.slice(2)));

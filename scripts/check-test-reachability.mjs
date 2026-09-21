import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrackedPaths } from "./check-tracked-artifacts.mjs";

const BASELINE = "scripts/test-reachability-baseline.json";
const MANIFEST = "scripts/test-reachability.json";
const TEST = /\.test\.(?:mjs|tsx?)$/;
const strings = (text) => [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
export const digest = (text) => createHash("sha256").update(text).digest("hex");

const patterns = new Map();
export function matches(path, glob) {
  if (patterns.has(glob)) return patterns.get(glob).test(path);
  if (glob.includes("{")) {
    const [part, choices] = glob.match(/\{([^}]+)\}/);
    return choices.split(",").some((choice) => matches(path, glob.replace(part, choice)));
  }
  const pattern = glob
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\0")
    .replace(/\*\*/g, "\x01")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replaceAll("\0", "(?:.*/)?")
    .replaceAll("\x01", ".*");
  const regex = new RegExp(`^${pattern}$`);
  patterns.set(glob, regex);
  return regex.test(path);
}

function readFilters(source) {
  return Object.fromEntries(
    [...source.matchAll(/^            ([\w-]+):\n((?:              - .*\n)+)/gm)].map(
      ([, name, body]) => {
        const globs = [...body.matchAll(/^              - (["'])(.*?)\1(?:\s+#.*)?$/gm)].map(
          (match) => match[2],
        );
        if (globs.some((glob) => glob.startsWith("!")))
          throw new Error("Negated path filters need an explicit reachability model");
        return [name, globs];
      },
    ),
  );
}

function jobField(body, key) {
  return body.match(new RegExp(`^    ${key}: (.*)$`, "m"))?.[1] ?? "";
}

function readJob(block) {
  const name = block.match(/^  ([\w-]+):/)[1];
  const body = block.slice(block.indexOf("\n") + 1);
  const condition = jobField(body, "if");
  const needs = jobField(body, "needs");
  return {
    name,
    body,
    condition,
    needs: needs.replace(/[[\]]/g, "").split(/,\s*/).filter(Boolean),
  };
}

// Reject unsupported control syntax instead of treating it as an unconditional job.
export function readWorkflow(source) {
  if (/^\s+(?:paths|paths-ignore|branches-ignore):/m.test(source.split("jobs:\n")[0]))
    throw new Error("Workflow trigger restrictions need an explicit reachability model");
  if (/^    (?:needs|if):\s*$/m.test(source))
    throw new Error("Block job conditions and dependencies need an explicit reachability model");
  if (/^\s+(?:- )?working-directory:/m.test(source))
    throw new Error("Working-directory overrides need an explicit reachability model");
  const body = source.split("jobs:\n")[1];
  const jobs = body
    .split(/(?=^  [\w-]+:$)/m)
    .filter((block) => /^  [\w-]+:/.test(block))
    .map(readJob);
  return { filters: readFilters(source), jobs };
}

function conditionEnabled(condition, path, filters) {
  const resolved = condition
    .replace(/needs\.changes\.outputs\.([\w-]+) == 'true'/g, (_, name) => {
      if (!filters[name]) throw new Error(`Unknown path filter: ${name}`);
      return String(filters[name].some((glob) => matches(path, glob)));
    })
    .replace(/always\(\)/g, "true")
    .replace(/github.event_name == 'pull_request'/g, "true")
    .replace(/\$\{\{|\}\}/g, "")
    .trim();
  if (!/^(?:true|false|\s|\|\||&&)+$/.test(resolved)) return false;
  return resolved
    .split("||")
    .some((part) => part.split("&&").every((term) => term.trim() === "true"));
}

function enabled(job, path, workflow, seen = []) {
  if (seen.includes(job.name)) throw new Error(`Cyclic job dependency: ${job.name}`);
  const active = conditionEnabled(job.condition || "true", path, workflow.filters);
  return (
    active &&
    job.needs.every((name) =>
      enabled(
        workflow.jobs.find((entry) => entry.name === name) ?? {
          name,
          condition: "false",
          needs: [],
        },
        path,
        workflow,
        [...seen, job.name],
      ),
    )
  );
}

function blockCommand(step, start) {
  const rest = step.slice(start.index + start[0].length);
  const lines = (rest.match(/^(?:          .*\n?)+/m)?.[0] ?? "")
    .trim()
    .split("\n")
    .map((line) => line.trim());
  return lines.join(start[1].startsWith(">") ? " " : "\n");
}

function commands(body) {
  return body.split(/(?=^      - )/m).flatMap((step) => {
    if (/^      (?:  |-[ ])if:/m.test(step)) return [];
    const start = step.match(/^\s+(?:- )?run: (.*)$/m);
    if (!start) return [];
    if (!/^[|>]-?$/.test(start[1])) return [start[1]];
    return [blockCommand(step, start)];
  });
}

function flatOptions(tokens) {
  let depth = 1;
  let result = "";
  for (const token of tokens) {
    depth -= Number(token === "}");
    if (depth === 0) return result;
    if (depth === 1) result += token;
    depth += Number(token === "{");
  }
  throw new Error("Unsupported test configuration");
}

function optionTokens(source) {
  return (
    source.match(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[{}]|[^{}"'`/]+|./g,
    ) ?? []
  );
}

function rejectQuotedSelectors(config) {
  if (/["'](?:test|include|exclude|projects|workspace)["']\s*:/.test(config))
    throw new Error("Quoted test selection keys need an explicit reachability model");
}

function testOptions(config) {
  rejectQuotedSelectors(config);
  const start = config.match(/\btest:\s*\{/);
  if (!start) {
    if (/\btest:/.test(config)) throw new Error("Nonliteral test configuration");
    return "";
  }
  const tokens = optionTokens(config.slice(start.index + start[0].length));
  const result = flatOptions(tokens.filter((token) => !/^\/[/*]/.test(token)));
  if (result.includes("...")) throw new Error("Unsupported test configuration");
  return result;
}

function selectionGlobs(testConfig, key, fallback) {
  const selection = testConfig.match(new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`));
  if (!selection) {
    if (new RegExp(`\\b${key}:`).test(testConfig)) throw new Error(`Unsupported ${key}`);
    return fallback;
  }
  if (selection[1].replace(/["'][^"']*["']/g, "").replace(/[,\s]/g, ""))
    throw new Error(`Nonliteral ${key}`);
  return strings(selection[1]);
}

function runnerSelection(cwd, files, read) {
  const configurations = files.filter(
    (path) => posix.dirname(path) === cwd && /(?:vitest|vite)\.config\./.test(path),
  );
  if (configurations.some((path) => !path.endsWith(".ts")))
    throw new Error(`Unsupported runner config: ${configurations.join(", ")}`);
  const config =
    ["vitest", "vite"]
      .map((name) => read(posix.join(cwd, `${name}.config.ts`)))
      .find((value) => value !== undefined) ?? "";
  const testConfig = testOptions(config);
  if (/\bprojects:|\bworkspace:/.test(testConfig))
    throw new Error(`Unsupported test projects in ${cwd}`);
  return {
    includes: selectionGlobs(testConfig, "include", ["**/*.test.{mjs,ts,tsx}"]),
    excludes: selectionGlobs(testConfig, "exclude", ["**/node_modules/**", "**/.git/**"]),
  };
}

function selectedByRunner(relative, args, { includes, excludes }) {
  if (excludes.some((glob) => matches(relative, glob))) return false;
  if (!includes.some((glob) => matches(relative, glob))) return false;
  return args.length === 0 || args.some((arg) => relative.includes(arg));
}

function runnerArguments(tokens, node, command) {
  const tail = tokens.slice(node ? tokens.indexOf("--test") + 1 : 2);
  if (
    tail.some(
      (token) => token.startsWith("-") && !["--coverage", "--passWithNoTests"].includes(token),
    )
  )
    throw new Error(`Unsupported test option: ${command}`);
  return tail.filter((token) => !token.startsWith("-"));
}

function runnerKind(command) {
  if (/^node\s.*--test(?:\s|$)/.test(command)) return "node";
  if (/^vitest run(?:\s|$)/.test(command)) return "vitest";
  if (/^bun test(?:\s|$)/.test(command)) return "bun";
  return undefined;
}

function runnerCommand(command) {
  const kind = runnerKind(command);
  if (!kind) return undefined;
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g).map((s) => s.replace(/^["']|["']$/g, ""));
  if (/[\n$`|;<>]/.test(command)) return undefined;
  return {
    node: kind === "node",
    vitest: kind === "vitest",
    args: runnerArguments(tokens, kind === "node", command),
  };
}

function runnerTests(command, cwd, files, read) {
  const runner = runnerCommand(command);
  if (!runner) return [];
  const { node, vitest, args } = runner;
  const selection = vitest
    ? runnerSelection(cwd, files, read)
    : { includes: ["**/*.test.{mjs,ts,tsx}"], excludes: [] };
  return files.filter((file) => {
    if (!TEST.test(file)) return false;
    const relative = posix.relative(cwd, file);
    if (relative.startsWith("../")) return false;
    if (node) return args.some((glob) => matches(relative, glob));
    return selectedByRunner(relative, args, selection);
  });
}

function pinnedJob(text, name) {
  return readWorkflow(text).jobs.find((job) => job.name === name)?.body ?? "";
}

function pinnedScript(text, name) {
  return JSON.parse(text).scripts[name] ?? "";
}

export function pinnedSource(path, read) {
  const [file, kind, name] = path.split("#");
  const text = read(file) ?? "";
  if (kind === "job") return pinnedJob(text, name);
  if (kind === "script") return pinnedScript(text, name);
  return text;
}

function adapterTests(adapter, files, read) {
  for (const [path, hash] of Object.entries(adapter.sources)) {
    if (digest(pinnedSource(path, read)) !== hash)
      throw new Error(`Runner mapping needs review: ${path}`);
  }
  return files.filter(
    (file) => TEST.test(file) && adapter.tests.some((glob) => matches(file, glob)),
  );
}

function packageSelected(pkg, option, target, cwd) {
  if (option === "--cwd") return pkg.cwd === posix.join(cwd, target);
  if (option !== "--filter") return pkg.cwd === cwd;
  if (pkg.cwd === ".") return false;
  return filterPackageName(pkg.name, target);
}
function filterPackageName(name, target) {
  const negate = target.startsWith("!");
  const pattern = negate ? target.slice(1) : target;
  return matches(name.replaceAll("/", ":"), pattern.replaceAll("/", ":")) !== negate;
}

function expandPackage(call, cwd, packages, files, read, adapters, seen) {
  const [, option, single, double, bare, script, args] = call;
  const target = single ?? double ?? bare;
  const selected = packages.filter((pkg) => packageSelected(pkg, option, target, cwd));
  return selected.flatMap((pkg) => {
    const body = pkg.scripts?.[script];
    if (!body) return [];
    const key = `${pkg.cwd}:${script}`;
    if (seen.includes(key)) throw new Error(`Cyclic package script: ${key}`);
    return expand(`${body}${args}`, pkg.cwd, packages, files, read, adapters, [...seen, key]);
  });
}

function expand(command, cwd, packages, files, read, adapters, seen = []) {
  const adapter = adapters.find((entry) => entry.command === command && entry.cwd === cwd);
  if (adapter) return adapterTests(adapter, files, read);
  if (command.includes("&&"))
    return command
      .split(/\s*&&\s*/)
      .flatMap((part) => expand(part, cwd, packages, files, read, adapters, seen));
  const call = command.match(
    /^bun run (?:(--cwd|--filter) (?:'([^']+)'|"([^"]+)"|(\S+)) )?([\w:*-]+)(.*)$/,
  );
  if (!call) return runnerTests(command, cwd, files, read);
  return expandPackage(call, cwd, packages, files, read, adapters, seen);
}

function testRoutes(workflow, packages, files, read, adapters) {
  const routes = new Map(files.filter((file) => TEST.test(file)).map((file) => [file, []]));
  for (const job of workflow.jobs) {
    for (const command of commands(job.body)) {
      for (const file of expand(command, ".", packages, files, read, adapters)) {
        routes.get(file).push(job);
      }
    }
  }
  return routes;
}

function declaredGuards(file, source, declarations) {
  if (declarations[file]) return declarations[file];
  const comment = source.split("\n")[0].match(/^\/\/ guards: (.+)$/)?.[1];
  return comment ? comment.split(/,\s*/) : [`${posix.dirname(file)}/**`];
}
function expandGuard(guard, file, files, cache) {
  if (!cache.has(guard))
    cache.set(guard, guard === file ? [file] : files.filter((p) => matches(p, guard)));
  const guarded = cache.get(guard);
  if (!guarded.length) throw new Error(`${file}: guard matches no tracked files: ${guard}`);
  return guarded;
}
function guardIssues(file, guards, jobs, files, workflow, cache) {
  if (!jobs.length) return ["no CI runner selects this test"];
  return [file, ...guards].flatMap((guard) => {
    const guarded = expandGuard(guard, file, files, cache);
    const missed = guarded.find((p) => !jobs.some((job) => enabled(job, p, workflow)));
    return missed ? [`CI filters exclude ${guard} (for example ${missed})`] : [];
  });
}

export function audit(files, read, manifest) {
  const workflow = readWorkflow(read(".github/workflows/ci.yml"));
  const packages = files
    .filter((p) => p === "package.json" || /^packages\/[^/]+\/package.json$/.test(p))
    .map((p) => ({ ...JSON.parse(read(p)), cwd: posix.dirname(p) }));
  const routes = testRoutes(workflow, packages, files, read, manifest.runners);
  const issues = {};
  const guardFiles = new Map();
  for (const file of files.filter((p) => TEST.test(p))) {
    const jobs = routes.get(file) ?? [];
    const guards = declaredGuards(file, read(file), manifest.guards);
    const failures = guardIssues(file, guards, jobs, files, workflow, guardFiles);
    if (failures.length) issues[file] = failures;
  }
  return issues;
}

function baselineIssues(file, count, current, previous) {
  const errors = [];
  if (![Number.isInteger(count), count > 0, count <= previous].every(Boolean))
    errors.push(`${file}: baseline may only shrink`);
  if (current < count) errors.push(`${file}: lower baseline to ${current}`);
  return errors;
}

export function ratchet(issues, baseline, previous = baseline) {
  const errors = Object.entries(issues).flatMap(([file, failures]) => {
    return failures.length > (baseline.files[file] ?? 0) ? [`${file}: ${failures.join("; ")}`] : [];
  });
  const budgetErrors = Object.entries(baseline.files).flatMap(([file, count]) =>
    baselineIssues(file, count, issues[file]?.length ?? 0, previous.files[file] ?? 0),
  );
  if (baseline.total !== Object.values(baseline.files).reduce((sum, n) => sum + n, 0))
    errors.push("Incorrect baseline total");
  return [...errors, ...budgetErrors];
}

function baseArgument(index) {
  const base = process.argv[index + 1];
  if (!base || base.startsWith("-")) throw new Error("--base needs a Git ref");
  return base;
}

function previousBaseline(baseline) {
  const index = process.argv.indexOf("--base");
  let previous = baseline;
  if (index !== -1) {
    const base = baseArgument(index);
    const paths = execFileSync("git", ["ls-tree", "--name-only", base, "--", BASELINE], {
      encoding: "utf8",
    });
    if (paths.trim())
      previous = JSON.parse(
        execFileSync("git", ["show", `${base}:${BASELINE}`], { encoding: "utf8" }),
      );
  }
  return previous;
}

function main() {
  const root = process.cwd();
  const files = readTrackedPaths(root);
  const read = (path) =>
    existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : undefined;
  const issues = audit(files, read, JSON.parse(read(MANIFEST)));
  if (process.argv.includes("--report")) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }
  const baseline = JSON.parse(read(BASELINE));
  const previous = previousBaseline(baseline);
  const errors = ratchet(issues, baseline, previous);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(`Test reachability verified: ${Object.keys(issues).length} baselined test files.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

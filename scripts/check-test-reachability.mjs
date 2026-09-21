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

// This reader accepts the workflow's indentation subset, not arbitrary YAML.
export function readWorkflow(source) {
  if (/^\s+(?:paths|paths-ignore|branches-ignore):/m.test(source.split("jobs:\n")[0]))
    throw new Error("Workflow trigger restrictions need an explicit reachability model");
  const filters = {};
  const jobs = [];
  let filter;
  let job;
  let inJobs = false;
  for (const line of source.split("\n")) {
    if (line === "jobs:") inJobs = true;
    const group = line.match(/^            ([\w-]+):$/);
    if (group) {
      filter = group[1];
      filters[filter] = [];
    }
    if (/^    (?:needs|if):\s*$/.test(line))
      throw new Error("Block job conditions and dependencies need an explicit reachability model");
    if (/^\s+(?:- )?working-directory:/.test(line))
      throw new Error("Working-directory overrides need an explicit reachability model");
    const pattern = line.match(/^              - (["'].*["'])$/);
    if (pattern && filter) {
      const glob = strings(pattern[1])[0];
      if (glob.startsWith("!"))
        throw new Error("Negated path filters need an explicit reachability model");
      filters[filter].push(glob);
    }
    const start = line.match(/^  ([\w-]+):$/);
    if (start && inJobs) {
      job = { name: start[1], body: "", condition: "", needs: [] };
      jobs.push(job);
    } else if (job) {
      job.body += `${line}\n`;
      if (line.startsWith("    if: ")) job.condition = line.slice(8);
      if (line.startsWith("    needs: "))
        job.needs = line
          .slice(11)
          .replace(/[\[\]]/g, "")
          .split(/,\s*/);
    }
  }
  return { filters, jobs };
}

function enabled(job, path, workflow, seen = []) {
  if (seen.includes(job.name)) throw new Error(`Cyclic job dependency: ${job.name}`);
  let condition = job.condition || "true";
  condition = condition
    .replace(/needs\.changes\.outputs\.([\w-]+) == 'true'/g, (_, name) => {
      if (!workflow.filters[name]) throw new Error(`Unknown path filter: ${name}`);
      return String(workflow.filters[name].some((glob) => matches(path, glob)));
    })
    .replace(/always\(\)/g, "true")
    .replace(/github.event_name == 'pull_request'/g, "true");
  condition = condition.replace(/\$\{\{|\}\}/g, "").trim();
  if (!/^(?:true|false|\s|\|\||&&|[()!])+$/.test(condition)) return false;
  if (/[()!]/.test(condition)) return false;
  const active = condition
    .split("||")
    .some((part) => part.split("&&").every((term) => term.trim() === "true"));
  return (
    active &&
    job.needs.every(
      (name) =>
        name === "changes" ||
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

function commands(body) {
  return body.split(/(?=^      - )/m).flatMap((step) => {
    if (/^      (?:  |-[ ])if:/m.test(step)) return [];
    const start = step.match(/^\s+(?:- )?run: (.*)$/m);
    if (!start) return [];
    if (!/^[|>]-?$/.test(start[1])) return [start[1]];
    const rest = step
      .slice(start.index + start[0].length)
      .split("\n")
      .slice(1);
    const lines = [];
    for (const line of rest) {
      if (!/^          /.test(line)) break;
      lines.push(line.trim());
    }
    return [lines.join(start[1].startsWith(">") ? " " : "\n")];
  });
}

function testOptions(config) {
  const start = config.match(/\btest:\s*\{/);
  if (!start) {
    if (/\btest:/.test(config)) throw new Error("Nonliteral test configuration");
    return "";
  }
  let depth = 1;
  let result = "";
  const tokens =
    config
      .slice(start.index + start[0].length)
      .match(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[{}]|[^{}"'`/]+|./g,
      ) ?? [];
  for (const token of tokens) {
    if (token.startsWith("//") || token.startsWith("/*")) continue;
    if (token === "}") depth--;
    if (depth === 0) break;
    if (depth === 1) result += token;
    if (token === "{") depth++;
  }
  if (depth !== 0 || result.includes("...")) throw new Error("Unsupported test configuration");
  return result;
}

function runnerTests(command, cwd, files, read) {
  const tokens =
    command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((s) => s.replace(/^["']|["']$/g, "")) ?? [];
  const node = tokens[0] === "node" && tokens.includes("--test");
  const vitest = tokens[0] === "vitest" && tokens[1] === "run";
  const bun = tokens[0] === "bun" && tokens[1] === "test";
  if (!node && !vitest && !bun) return [];
  if (tokens.some((token) => /[$`|;<>]/.test(token))) return [];
  const tail = tokens.slice(node ? tokens.indexOf("--test") + 1 : 2);
  if (
    tail.some(
      (token) => token.startsWith("-") && !["--coverage", "--passWithNoTests"].includes(token),
    )
  )
    throw new Error(`Unsupported test option: ${command}`);
  const args = tail.filter((token) => !token.startsWith("-"));
  let includes = ["**/*.test.{mjs,ts,tsx}"];
  let excludes = ["**/node_modules/**", "**/.git/**"];
  if (vitest) {
    const configurations = files.filter(
      (path) => posix.dirname(path) === cwd && /(?:vitest|vite)\.config\./.test(path),
    );
    if (configurations.some((path) => !path.endsWith(".ts")))
      throw new Error(`Unsupported runner config: ${configurations.join(", ")}`);
    const config =
      read(posix.join(cwd, "vitest.config.ts")) ?? read(posix.join(cwd, "vite.config.ts")) ?? "";
    const testConfig = testOptions(config);
    for (const key of ["include", "exclude"]) {
      const selection = testConfig.match(new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`));
      if (new RegExp(`\\b${key}:`).test(testConfig) && !selection)
        throw new Error(`Unsupported ${key} in ${cwd}`);
      if (!selection) continue;
      if (selection[1].replace(/["'][^"']*["']/g, "").replace(/[,\s]/g, ""))
        throw new Error(`Nonliteral ${key} in ${cwd}`);
      if (key === "include") includes = strings(selection[1]);
      else excludes = strings(selection[1]);
    }
    if (/\bprojects:|\bworkspace:/.test(testConfig))
      throw new Error(`Unsupported test projects in ${cwd}`);
  }
  return files.filter((file) => {
    if (!TEST.test(file)) return false;
    const relative = posix.relative(cwd, file);
    if (relative.startsWith("../")) return false;
    if (node) return args.some((glob) => matches(relative, glob));
    if (excludes.some((glob) => matches(relative, glob))) return false;
    return (
      includes.some((glob) => matches(relative, glob)) &&
      (args.length === 0 || args.some((arg) => relative.includes(arg)))
    );
  });
}

export function pinnedSource(path, read) {
  const [file, kind, name] = path.split("#");
  const text = read(file) ?? "";
  if (kind === "job") return readWorkflow(text).jobs.find((job) => job.name === name)?.body ?? "";
  if (kind === "script") return JSON.parse(text).scripts[name] ?? "";
  return text;
}

function expand(command, cwd, packages, files, read, adapters, seen = []) {
  const adapter = adapters.find((entry) => entry.command === command && entry.cwd === cwd);
  if (adapter) {
    for (const [path, hash] of Object.entries(adapter.sources)) {
      if (digest(pinnedSource(path, read)) !== hash)
        throw new Error(`Runner mapping needs review: ${path}`);
    }
    return files.filter(
      (file) => TEST.test(file) && adapter.tests.some((glob) => matches(file, glob)),
    );
  }
  if (command.includes("${") || command.includes("\n")) return [];
  if (command.includes("&&"))
    return command
      .split(/\s*&&\s*/)
      .flatMap((part) => expand(part, cwd, packages, files, read, adapters, seen));
  const call = command.match(
    /^bun run (?:(--cwd|--filter) (?:'([^']+)'|"([^"]+)"|(\S+)) )?([\w:*-]+)(.*)$/,
  );
  if (!call) return runnerTests(command, cwd, files, read);
  const [, option, single, double, bare, script, args] = call;
  const target = single ?? double ?? bare;
  const selected = packages.filter((pkg) => {
    if (option === "--cwd") return pkg.cwd === posix.join(cwd, target);
    if (option === "--filter")
      return target.startsWith("!")
        ? pkg.cwd !== "." &&
            !matches(pkg.name.replaceAll("/", ":"), target.slice(1).replaceAll("/", ":"))
        : pkg.cwd !== "." && matches(pkg.name.replaceAll("/", ":"), target.replaceAll("/", ":"));
    return pkg.cwd === cwd;
  });
  return selected.flatMap((pkg) => {
    const body = pkg.scripts?.[script];
    if (!body) return [];
    const key = `${pkg.cwd}:${script}`;
    if (seen.includes(key)) throw new Error(`Cyclic package script: ${key}`);
    return expand(`${body}${args}`, pkg.cwd, packages, files, read, adapters, [...seen, key]);
  });
}

export function audit(files, read, manifest) {
  const workflow = readWorkflow(read(".github/workflows/ci.yml"));
  const packages = files
    .filter((p) => p === "package.json" || /^packages\/[^/]+\/package.json$/.test(p))
    .map((p) => ({ ...JSON.parse(read(p)), cwd: posix.dirname(p) }));
  const routes = new Map();
  for (const job of workflow.jobs) {
    for (const command of commands(job.body)) {
      for (const file of expand(command, ".", packages, files, read, manifest.runners)) {
        routes.set(file, [...(routes.get(file) ?? []), job]);
      }
    }
  }
  const issues = {};
  const guardFiles = new Map();
  for (const file of files.filter((p) => TEST.test(p))) {
    const jobs = routes.get(file) ?? [];
    const comment = read(file)
      .split("\n")[0]
      .match(/^\/\/ guards: (.+)$/)?.[1];
    const guards =
      manifest.guards[file] ?? (comment ? comment.split(/,\s*/) : [`${posix.dirname(file)}/**`]);
    const failures = [];
    if (!jobs.length) failures.push("no CI runner selects this test");
    else
      for (const guard of [file, ...guards]) {
        if (!guardFiles.has(guard))
          guardFiles.set(
            guard,
            files.filter((p) => matches(p, guard)),
          );
        const guarded = guardFiles.get(guard);
        if (!guarded.length) throw new Error(`${file}: guard matches no tracked files: ${guard}`);
        const missed = guarded.find((p) => !jobs.some((job) => enabled(job, p, workflow)));
        if (missed) failures.push(`CI filters exclude ${guard} (for example ${missed})`);
      }
    if (failures.length) issues[file] = failures;
  }
  return issues;
}

export function ratchet(issues, baseline, previous = baseline) {
  const errors = [];
  for (const [file, failures] of Object.entries(issues)) {
    if (failures.length > (baseline.files[file] ?? 0))
      errors.push(`${file}: ${failures.join("; ")}`);
  }
  for (const [file, count] of Object.entries(baseline.files)) {
    if (!Number.isInteger(count) || count < 1 || count > (previous.files[file] ?? 0))
      errors.push(`${file}: baseline may only shrink`);
    if ((issues[file]?.length ?? 0) < count)
      errors.push(`${file}: lower baseline to ${issues[file]?.length ?? 0}`);
  }
  if (baseline.total !== Object.values(baseline.files).reduce((sum, n) => sum + n, 0))
    errors.push("Incorrect baseline total");
  return errors;
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
  const index = process.argv.indexOf("--base");
  let previous = baseline;
  if (index !== -1) {
    const base = process.argv[index + 1];
    if (!base || base.startsWith("-")) throw new Error("--base needs a Git ref");
    const paths = execFileSync("git", ["ls-tree", "--name-only", base, "--", BASELINE], {
      encoding: "utf8",
    });
    if (paths.trim())
      previous = JSON.parse(
        execFileSync("git", ["show", `${base}:${BASELINE}`], { encoding: "utf8" }),
      );
  }
  const errors = ratchet(issues, baseline, previous);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(`Test reachability verified: ${Object.keys(issues).length} baselined test files.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

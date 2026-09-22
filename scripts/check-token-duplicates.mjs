#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THEME = "packages/studio/src/styles/theme.css";
const BASELINE = "scripts/token-duplicates-baseline.json";
const normalize = (value) => value.replace(/\s+/g, " ").trim();

function tokenGroups(css) {
  const groups = new Map();
  const names = new Set();
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
  for (const [, name, raw] of declarations) {
    if (names.has(name)) throw new Error(`Ambiguous token definition: ${name}`);
    names.add(name);
    const value = normalize(raw);
    const group = groups.get(value) ?? [];
    group.push(name);
    groups.set(value, group);
  }
  return groups;
}

function pairs(names) {
  return names.flatMap((name, index) =>
    names.slice(index + 1).map((other) => [name, other].sort()),
  );
}

function allowedPair(tokens, value, allowlist) {
  return allowlist.some((entry) => {
    if (typeof entry.reason !== "string") return false;
    return [
      entry.reason.trim(),
      normalize(entry.value) === value,
      JSON.stringify([...entry.tokens].sort()) === JSON.stringify(tokens),
    ].every(Boolean);
  });
}

export function duplicateTokens(css, allowlist = []) {
  return [...tokenGroups(css)].flatMap(([value, names]) => {
    if (/^var\(--[\w-]+\)$/.test(value)) return [];
    return pairs(names)
      .filter((tokens) => !allowedPair(tokens, value, allowlist))
      .map((tokens) => ({ tokens, value, key: tokens.join(" + ") }));
  });
}

function baselineIssue(key, value, current, previous) {
  if (previous[key] !== value) return `${key}: baseline may only shrink`;
  if (current.get(key) !== value) return `${key}: remove stale baseline pair`;
  return undefined;
}

export function ratchet(duplicates, baseline, previous = baseline) {
  const current = new Map(duplicates.map((entry) => [entry.key, entry.value]));
  const issues = duplicates
    .filter((entry) => baseline.pairs[entry.key] !== entry.value)
    .map((entry) => `${entry.key}: duplicate value ${entry.value}`);
  for (const [key, value] of Object.entries(baseline.pairs)) {
    const issue = baselineIssue(key, value, current, previous.pairs);
    if (issue) issues.push(issue);
  }
  if (baseline.files[THEME] !== Object.keys(baseline.pairs).length)
    issues.push("Incorrect baseline file count");
  if (baseline.total !== baseline.files[THEME]) issues.push("Incorrect baseline total");
  return issues;
}

function previousBaseline(base, fallback) {
  const paths = execFileSync("git", ["ls-tree", "--name-only", base, "--", BASELINE], {
    encoding: "utf8",
  });
  if (!paths.trim()) return fallback;
  return JSON.parse(execFileSync("git", ["show", `${base}:${BASELINE}`], { encoding: "utf8" }));
}

function main() {
  const read = (file) => readFileSync(file, "utf8");
  const duplicates = duplicateTokens(
    read(THEME),
    JSON.parse(read("scripts/token-duplicates-allowlist.json")),
  );
  const baseline = JSON.parse(read(BASELINE));
  const issues = ratchet(
    duplicates,
    baseline,
    previousBaseline(process.argv[2] ?? "origin/main", baseline),
  );
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Token duplicates verified: ${baseline.total} baselined pairs.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

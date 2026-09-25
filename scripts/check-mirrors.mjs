#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrackedPaths } from "./check-tracked-artifacts.mjs";

const BASELINE = "scripts/mirrors-baseline.json";
export const pairKey = (pair) => [pair.left, pair.right].sort().join(" <=> ");

function validatePair(pair) {
  for (const file of [pair.left, pair.right]) {
    if (typeof file !== "string") throw new Error("Mirror paths must be strings");
    if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(file)) throw new Error(`Invalid mirror path: ${file}`);
    if (file.split("/").includes("..")) throw new Error(`Invalid mirror path: ${file}`);
  }
  if (pair.left === pair.right) throw new Error("A mirror must name two different files");
}
function allowedPairs(manifest, keys) {
  return new Set(manifest.allowlist.map((entry) => {
    validatePair(entry);
    if (typeof entry.reason !== "string") throw new Error("Mirror allowance requires a reason");
    if (![entry.reason.trim(), keys.has(pairKey(entry))].every(Boolean)) throw new Error("Stale or unexplained mirror allowance");
    return pairKey(entry);
  }));
}
function pairIssues(pair, files, read, allowed) {
  const missing = [pair.left, pair.right].filter((file) => !files.has(file));
  if (missing.length) return missing.map((file) => ({ file, message: "mirror file is missing" }));
  if (allowed.has(pairKey(pair))) return [];
  if (read(pair.left).equals(read(pair.right))) return [];
  return [pair.left, pair.right].map((file) => ({ file, message: `mirror differs: ${pairKey(pair)}` }));
}
export function mirrorIssues(files, read, manifest) {
  manifest.pairs.forEach(validatePair);
  const keys = new Set(manifest.pairs.map(pairKey));
  if (!keys.size || keys.size !== manifest.pairs.length) throw new Error("Empty or duplicate mirror pairs");
  const allowed = allowedPairs(manifest, keys);
  const tracked = new Set(files);
  return manifest.pairs.flatMap((pair) => pairIssues(pair, tracked, read, allowed));
}
function budgetIssue(file, count, actual, old) {
  if (![Number.isInteger(count), count > 0, count <= old].every(Boolean)) return `${file}: baseline may only shrink`;
  return actual < count ? `${file}: lower baseline to ${actual}` : undefined;
}
export function ratchet(issues, baseline, previous = baseline) {
  const counts = {};
  for (const issue of issues) counts[issue.file] = (counts[issue.file] ?? 0) + 1;
  const failures = Object.entries(counts).filter(([file, count]) => count > (baseline.files[file] ?? 0))
    .map(([file]) => `${file}: new mirror violation`);
  const budgets = Object.entries(baseline.files).map(([file, count]) => budgetIssue(file, count, counts[file] ?? 0, previous.files[file] ?? 0)).filter(Boolean);
  if (baseline.total !== Object.values(baseline.files).reduce((sum, count) => sum + count, 0)) failures.push("Incorrect baseline total");
  return [...failures, ...budgets];
}
export function repositoryMirrorIssues() {
  const files = readTrackedPaths().filter((file) => existsSync(file));
  return mirrorIssues(files, (file) => readFileSync(file), JSON.parse(readFileSync("scripts/mirrors.json", "utf8")));
}
function previousBaseline(base, fallback) {
  const files = execFileSync("git", ["ls-tree", "--full-tree", "--name-only", base, "--", BASELINE], { encoding: "utf8" });
  if (!files.trim()) return fallback;
  return JSON.parse(execFileSync("git", ["show", `${base}:${BASELINE}`], { encoding: "utf8" }));
}
function main() {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const issues = ratchet(repositoryMirrorIssues(), baseline, previousBaseline(process.argv[2] ?? "origin/main", baseline));
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Mirrors verified: ${baseline.total} baselined violations.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

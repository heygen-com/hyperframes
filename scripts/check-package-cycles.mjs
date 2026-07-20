#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

/**
 * The deprecated @hyperframes/core/studio-api forwarding surface is public and
 * cannot disappear before a breaking release. Keep its one known package SCC
 * explicit so every new cycle still fails CI. Delete this exception together
 * with the forwarding surface in the next breaking release.
 */
export const ALLOWED_COMPATIBILITY_CYCLES = [
  {
    packages: ["@hyperframes/core", "@hyperframes/studio-server"],
    reason: "Deprecated core/studio-api forwarding exports; remove at the next breaking release.",
  },
];

function canonicalComponent(names) {
  return [...names].sort().join(" -> ");
}

export function listRuntimePackageCycles(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const edges = new Map(
    // Collecting three dependency classes in one expression keeps the graph
    // construction declarative; focused tests cover runtime versus dev edges.
    // fallow-ignore-next-line complexity
    packages.map((pkg) => {
      const targets = new Set();
      for (const field of RUNTIME_DEPENDENCY_FIELDS) {
        for (const dependency of Object.keys(pkg[field] ?? {})) {
          if (byName.has(dependency)) targets.add(dependency);
        }
      }
      return [pkg.name, [...targets].sort()];
    }),
  );

  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  // Tarjan's strongly-connected-component walk is intentionally branchy; the
  // state transitions mirror the algorithm and are covered by focused tests.
  // fallow-ignore-next-line complexity
  function visit(name) {
    indexes.set(name, nextIndex);
    lowLinks.set(name, nextIndex);
    nextIndex += 1;
    stack.push(name);
    onStack.add(name);

    for (const target of edges.get(name) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(name, Math.min(lowLinks.get(name), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(name, Math.min(lowLinks.get(name), indexes.get(target)));
      }
    }

    if (lowLinks.get(name) !== indexes.get(name)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== name);

    const selfCycle = component.length === 1 && (edges.get(name) ?? []).includes(name);
    if (component.length > 1 || selfCycle) components.push(component.sort());
  }

  for (const name of [...byName.keys()].sort()) {
    if (!indexes.has(name)) visit(name);
  }
  return components.sort((a, b) => canonicalComponent(a).localeCompare(canonicalComponent(b)));
}

export function listPackageCycleIssues(packages, allowed = ALLOWED_COMPATIBILITY_CYCLES) {
  const allowedKeys = new Set(allowed.map((entry) => canonicalComponent(entry.packages)));
  return listRuntimePackageCycles(packages)
    .map(canonicalComponent)
    .filter((component) => !allowedKeys.has(component))
    .map((component) => `runtime workspace dependency cycle: ${component}`);
}

export function readWorkspacePackages(root = ROOT) {
  return readdirSync(join(root, "packages"))
    .sort()
    .map((directory) => join(root, "packages", directory, "package.json"))
    .filter(existsSync)
    .map((path) => JSON.parse(readFileSync(path, "utf8")));
}

function main() {
  const packages = readWorkspacePackages();
  const cycles = listRuntimePackageCycles(packages);
  const issues = listPackageCycleIssues(packages);
  if (issues.length > 0) {
    console.error("Package cycle violations:");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }

  const allowedKeys = new Set(
    ALLOWED_COMPATIBILITY_CYCLES.map((entry) => canonicalComponent(entry.packages)),
  );
  const activeCompatibilityCycles = cycles.filter((cycle) =>
    allowedKeys.has(canonicalComponent(cycle)),
  );
  if (activeCompatibilityCycles.length > 0) {
    console.log(
      `Package graph verified; ${activeCompatibilityCycles.length} explicit compatibility cycle remains until the next breaking release.`,
    );
    return;
  }
  console.log("Package graph verified: runtime workspace dependencies are acyclic.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

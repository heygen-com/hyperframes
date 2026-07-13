#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
export const REQUIRED_WORKSPACE_SCRIPTS = ["build", "typecheck", "test"];

function hasExecutableScript(pkg, script) {
  return typeof pkg.scripts?.[script] === "string" && pkg.scripts[script].trim().length > 0;
}

function hasSpecificReason(reason) {
  return typeof reason === "string" ? reason.trim().length >= 20 : false;
}

function hasDocumentedOptOut(pkg, script) {
  const optOut = pkg.hyperframesWorkspaceContract?.[script];
  return optOut?.optOut === true && hasSpecificReason(optOut.reason);
}

export function listWorkspaceContractIssues(workspace, pkg) {
  return REQUIRED_WORKSPACE_SCRIPTS.flatMap((script) => {
    if (hasExecutableScript(pkg, script) || hasDocumentedOptOut(pkg, script)) return [];
    return [
      `${workspace}: missing executable \`${script}\` script or ` +
        `hyperframesWorkspaceContract.${script} opt-out with a specific reason`,
    ];
  });
}

export function listWorkspacePackages(root = ROOT) {
  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir)
    .sort()
    .filter((name) => existsSync(join(packagesDir, name, "package.json")))
    .map((name) => {
      const workspace = `packages/${name}`;
      const pkg = JSON.parse(readFileSync(join(root, workspace, "package.json"), "utf8"));
      return { workspace, pkg };
    });
}

export function checkWorkspaceContracts(root = ROOT) {
  return listWorkspacePackages(root).flatMap(({ workspace, pkg }) =>
    listWorkspaceContractIssues(workspace, pkg),
  );
}

function main() {
  const issues = checkWorkspaceContracts();
  if (issues.length > 0) {
    console.error("Workspace contract violations:");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log("Workspace contracts verified: build, typecheck, and test are explicit.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

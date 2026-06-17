#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function listWorkspacePackageDirs() {
  return readdirSync(PACKAGES_DIR)
    .map((dir) => join("packages", dir))
    .filter((dir) => existsSync(join(ROOT, dir, "package.json")));
}

function listWorkspaceRefs(pkg) {
  const refs = [];

  for (const field of DEP_FIELDS) {
    for (const [depName, spec] of Object.entries(pkg[field] || {})) {
      if (String(spec).startsWith("workspace:")) {
        refs.push(`${field}:${depName}=${spec}`);
      }
    }
  }

  return refs;
}

function parsePackJson(output, workspace) {
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error(`Could not parse pnpm pack JSON output for ${workspace}`);
  }
}

function main() {
  for (const workspace of listWorkspacePackageDirs()) {
    const sourcePackageJson = JSON.parse(
      readFileSync(join(ROOT, workspace, "package.json"), "utf8"),
    );
    if (sourcePackageJson.private) continue;
    if (listWorkspaceRefs(sourcePackageJson).length === 0) continue;

    const packDir = mkdtempSync(join(tmpdir(), "hyperframes-pack-"));
    const packOutput = execFileSync("pnpm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: join(ROOT, workspace),
      encoding: "utf8",
    });
    const [{ filename }] = parsePackJson(packOutput, workspace);

    try {
      const packedPackageJson = execFileSync("tar", ["-xOf", filename, "package/package.json"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      const packedRefs = listWorkspaceRefs(JSON.parse(packedPackageJson));

      if (packedRefs.length > 0) {
        throw new Error(
          `Packed manifest for ${workspace} still contains workspace refs: ${packedRefs.join(", ")}`,
        );
      }

      console.log(`Verified ${workspace}: packed manifest is publish-safe.`);
    } finally {
      rmSync(packDir, { force: true, recursive: true });
    }
  }
}

main();

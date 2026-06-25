#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const RUNTIME_IMPORT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".wasm", ".node"]);

function listWorkspacePackageDirs() {
  return readdirSync(PACKAGES_DIR)
    .map((dir) => join("packages", dir))
    .filter((dir) => existsSync(join(ROOT, dir, "package.json")));
}

function listWorkspaceRefs(pkg) {
  return DEP_FIELDS.flatMap((field) =>
    Object.entries(pkg[field] || {})
      .filter(([, spec]) => String(spec).startsWith("workspace:"))
      .map(([depName, spec]) => `${field}:${depName}=${spec}`),
  );
}

function listMissingPublishedExports(pkg) {
  if (!pkg.exports || !pkg.publishConfig?.exports) return [];

  return Object.keys(pkg.exports).filter((exportKey) => !(exportKey in pkg.publishConfig.exports));
}

function normalizePackagePath(path) {
  return path.replace(/^\.\//, "");
}

function isPackageLocalPath(path) {
  return path.startsWith("./") || path.startsWith("dist/") || path.startsWith("src/");
}

function isPublishedSourceEntrypoint(path) {
  return /^src\/.*\.(?:ts|tsx|mts|cts)$/.test(normalizePackagePath(path));
}

function appendManifestEntry(entries, trail, path) {
  entries.push({ field: trail.join(".") || "<root>", path });
}

function collectStringEntrypoint(value, trail, entries) {
  appendManifestEntry(entries, trail, value);
  return entries;
}

function collectArrayEntrypoints(value, trail, entries) {
  value.forEach((item, index) =>
    collectManifestEntrypoints(item, [...trail, String(index)], entries),
  );
  return entries;
}

function collectObjectEntrypoints(value, trail, entries) {
  Object.entries(value).forEach(([key, nested]) =>
    collectManifestEntrypoints(nested, [...trail, key], entries),
  );
  return entries;
}

function isStringEntrypoint(value) {
  return typeof value === "string";
}

function isArrayEntrypoint(value) {
  return Array.isArray(value);
}

function isObjectEntrypoint(value) {
  return Boolean(value) && typeof value === "object";
}

const MANIFEST_ENTRY_COLLECTORS = [
  [isStringEntrypoint, collectStringEntrypoint],
  [isArrayEntrypoint, collectArrayEntrypoints],
  [isObjectEntrypoint, collectObjectEntrypoints],
];

function collectManifestEntrypoints(value, trail = [], entries = []) {
  const collector = MANIFEST_ENTRY_COLLECTORS.find(([matches]) => matches(value));
  return collector ? collector[1](value, trail, entries) : entries;
}

function listPackedEntrypoints(pkg) {
  const entries = [];

  for (const field of ["main", "module", "types", "typings"]) {
    if (typeof pkg[field] === "string") {
      entries.push({ field, path: pkg[field] });
    }
  }

  if (pkg.exports != null) {
    entries.push(...collectManifestEntrypoints(pkg.exports, ["exports"]));
  }

  return entries.filter((entry) => isPackageLocalPath(entry.path));
}

function listPackedFiles(filename) {
  const output = execFileSync("tar", ["-tf", filename], {
    cwd: ROOT,
    encoding: "utf8",
  });

  return new Set(
    output
      .split("\n")
      .filter(Boolean)
      .map((path) => path.replace(/^package\//, "")),
  );
}

function stripSpecifierQuery(specifier) {
  return specifier.replace(/[?#].*$/, "");
}

function hasExplicitRuntimeExtension(specifier) {
  return RUNTIME_IMPORT_EXTENSIONS.has(extname(stripSpecifierQuery(specifier)));
}

function listRelativeImportSpecifiers(source) {
  const patterns = [
    /^\s*import\s+["'](\.\.?\/[^"']+)["']/gm,
    /^\s*(?:import|export)\s+[^;]*?\s+from\s+["'](\.\.?\/[^"']+)["']/gm,
  ];
  const specifiers = [];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push({ index: match.index, specifier: match[1] });
    }
  }

  return specifiers;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function readPackedFile(filename, file) {
  return execFileSync("tar", ["-xOf", filename, `package/${file}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function verifyPackedEntrypoints(workspace, packedPackage, packedFiles) {
  const entries = listPackedEntrypoints(packedPackage);
  const sourceEntries = entries.filter((entry) => isPublishedSourceEntrypoint(entry.path));
  if (sourceEntries.length > 0) {
    throw new Error(
      `Packed manifest for ${workspace} exposes source TypeScript entrypoints: ` +
        sourceEntries.map((entry) => `${entry.field}:${entry.path}`).join(", "),
    );
  }

  const missingEntries = entries.filter((entry) => {
    const normalized = normalizePackagePath(entry.path);
    return !normalized.includes("*") && !packedFiles.has(normalized);
  });

  if (missingEntries.length > 0) {
    throw new Error(
      `Packed manifest for ${workspace} points at missing files: ` +
        missingEntries.map((entry) => `${entry.field}:${entry.path}`).join(", "),
    );
  }
}

function listJavaScriptImportIssues(filename, file) {
  const source = readPackedFile(filename, file);
  return listRelativeImportSpecifiers(source)
    .filter(({ specifier }) => !hasExplicitRuntimeExtension(specifier))
    .map(({ index, specifier }) => `${file}:${lineNumberAt(source, index)} imports ${specifier}`);
}

function listPackedJavaScriptImportIssues(filename, packedFiles) {
  return [...packedFiles]
    .filter((file) => file.endsWith(".js"))
    .flatMap((file) => listJavaScriptImportIssues(filename, file));
}

function verifyPackedJavaScriptImports(workspace, filename, packedFiles) {
  const importIssues = listPackedJavaScriptImportIssues(filename, packedFiles);
  if (importIssues.length > 0) {
    throw new Error(
      `Packed JavaScript for ${workspace} contains Node-incompatible relative imports: ` +
        importIssues.slice(0, 10).join(", "),
    );
  }
}

function parsePackJson(output, workspace) {
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error(`Could not parse pnpm pack JSON output for ${workspace}`);
  }
}

function readWorkspacePackage(workspace) {
  return JSON.parse(readFileSync(join(ROOT, workspace, "package.json"), "utf8"));
}

function assertPublishedExportsMatchSource(workspace, sourcePackageJson) {
  const missingPublishedExports = listMissingPublishedExports(sourcePackageJson);
  if (missingPublishedExports.length === 0) return;

  throw new Error(
    `${workspace} publishConfig.exports is missing source exports: ${missingPublishedExports.join(", ")}`,
  );
}

function packWorkspace(workspace, packDir) {
  const packOutput = execFileSync("pnpm", ["pack", "--json", "--pack-destination", packDir], {
    cwd: join(ROOT, workspace),
    encoding: "utf8",
  });
  const [{ filename }] = parsePackJson(packOutput, workspace);
  return filename;
}

function readPackedPackage(filename) {
  const packedPackageJson = execFileSync("tar", ["-xOf", filename, "package/package.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return JSON.parse(packedPackageJson);
}

function assertNoWorkspaceRefs(workspace, packedPackage) {
  const packedRefs = listWorkspaceRefs(packedPackage);
  if (packedRefs.length === 0) return;

  throw new Error(
    `Packed manifest for ${workspace} still contains workspace refs: ${packedRefs.join(", ")}`,
  );
}

function verifyPackedWorkspace(workspace, filename) {
  const packedPackage = readPackedPackage(filename);
  const packedFiles = listPackedFiles(filename);

  assertNoWorkspaceRefs(workspace, packedPackage);
  verifyPackedEntrypoints(workspace, packedPackage, packedFiles);
  verifyPackedJavaScriptImports(workspace, filename, packedFiles);
}

function verifyWorkspace(workspace) {
  const sourcePackageJson = readWorkspacePackage(workspace);
  if (sourcePackageJson.private) return;

  assertPublishedExportsMatchSource(workspace, sourcePackageJson);

  const packDir = mkdtempSync(join(tmpdir(), "hyperframes-pack-"));
  try {
    verifyPackedWorkspace(workspace, packWorkspace(workspace, packDir));
    console.log(`Verified ${workspace}: packed manifest is publish-safe.`);
  } finally {
    rmSync(packDir, { force: true, recursive: true });
  }
}

function main() {
  listWorkspacePackageDirs().forEach(verifyWorkspace);
}

main();

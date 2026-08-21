// Manifest condition normalization is deliberately branch-heavy; every shape
// is covered by package-subpaths.test.mjs and the clean packed-consumer gate.
// fallow-ignore-file complexity
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const DESCRIPTOR_FILE = "package-subpaths.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceTarget(target) {
  if (typeof target === "string") return target;
  return target?.bun ?? target?.browser ?? target?.import ?? target?.node;
}

function runtimeTarget(target) {
  if (typeof target === "string") return target;
  if (!target) return undefined;
  const conditions = Object.fromEntries(
    Object.entries(target).filter(
      ([condition]) => !["types", "bun", "browser"].includes(condition),
    ),
  );
  return Object.keys(conditions).length === 1 && conditions.import ? conditions.import : conditions;
}

function typeTarget(target) {
  return typeof target === "object" && target !== null ? target.types : undefined;
}

function inferEnvironments(localTarget, types) {
  if (typeof localTarget === "object" && localTarget?.browser) return ["browser", "bun"];
  if (!types && String(sourceTarget(localTarget)).includes("runtime.iife")) return ["browser"];
  return ["browser", "bun", "node"];
}

function primaryRuntime(runtime) {
  return typeof runtime === "string"
    ? runtime
    : (runtime.node ?? runtime.import ?? runtime.require ?? runtime.script);
}

function runtimeConditions(runtime) {
  return typeof runtime === "string" ? { import: runtime } : runtime;
}

export function descriptorFromManifest(pkg) {
  const localExports = pkg.exports ?? {};
  const publishedExports = pkg.publishConfig?.exports ?? {};
  const localNodeRuntime = Object.values(localExports).some(
    (target) => typeof target === "object" && target !== null && target.node != null,
  );
  const keys = [...Object.keys(localExports)];
  for (const key of Object.keys(publishedExports)) {
    if (!keys.includes(key)) keys.push(key);
  }

  return {
    package: pkg.name,
    ...(localNodeRuntime ? { localNodeRuntime: true } : {}),
    subpaths: Object.fromEntries(
      keys.map((key) => {
        const localTarget = localExports[key];
        const publishedTarget = publishedExports[key];
        const source = sourceTarget(localTarget ?? publishedTarget);
        const runtime = runtimeTarget(publishedTarget ?? localTarget);
        const types = typeTarget(publishedTarget ?? localTarget);
        return [
          key,
          {
            source,
            runtime,
            types: types ?? null,
            environments: inferEnvironments(localTarget, types),
          },
        ];
      }),
    ),
  };
}

function localExport(contract, { localNodeRuntime = false } = {}) {
  const runtime = primaryRuntime(contract.runtime);
  const dualManifest = contract.source !== runtime;
  if (!dualManifest) return publishedExport(contract);
  if (!contract.types) return contract.source;
  const browserOnly =
    contract.environments.includes("browser") && !contract.environments.includes("node");
  if (browserOnly) {
    return {
      browser: contract.source,
      bun: contract.source,
      import: contract.source,
      types: contract.source,
    };
  }
  const conditions = runtimeConditions(contract.runtime);
  return {
    bun: contract.source,
    ...(localNodeRuntime ? { node: conditions.node ?? conditions.import } : {}),
    import: contract.source,
    types: contract.source,
    ...Object.fromEntries(
      Object.entries(conditions).filter(([condition]) => !["node", "import"].includes(condition)),
    ),
  };
}

function publishedExport(contract) {
  if (typeof contract.runtime === "string") {
    if (!contract.types) return contract.runtime;
    return { import: contract.runtime, types: contract.types };
  }
  return {
    ...(contract.types ? { types: contract.types } : {}),
    ...runtimeConditions(contract.runtime),
  };
}

export function exportsFromDescriptor(descriptor) {
  return {
    local: Object.fromEntries(
      Object.entries(descriptor.subpaths).map(([key, contract]) => [
        key,
        localExport(contract, { localNodeRuntime: descriptor.localNodeRuntime === true }),
      ]),
    ),
    published: Object.fromEntries(
      Object.entries(descriptor.subpaths).map(([key, contract]) => [
        key,
        publishedExport(contract),
      ]),
    ),
  };
}

export function sourceAliasEntries(descriptor, packageDir, exportKeys) {
  const selected = exportKeys ? new Set(exportKeys) : null;
  return Object.entries(descriptor.subpaths).flatMap(([key, contract]) => {
    if (selected && !selected.has(key)) return [];
    if (!contract.source?.match(/\.[cm]?[jt]sx?$/)) return [];
    const specifier = key === "." ? descriptor.package : `${descriptor.package}/${key.slice(2)}`;
    return [[specifier, resolve(packageDir, contract.source)]];
  });
}

export function readPackageSubpaths(packageDir) {
  return readJson(join(packageDir, DESCRIPTOR_FILE));
}

export function sourceAliases(packageDir, exportKeys) {
  return Object.fromEntries(
    sourceAliasEntries(readPackageSubpaths(packageDir), packageDir, exportKeys),
  );
}

export function listPublicWorkspacePackageDirs(root = ROOT) {
  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir)
    .sort()
    .map((name) => join(packagesDir, name))
    .filter((packageDir) => {
      const manifestPath = join(packageDir, "package.json");
      if (!existsSync(manifestPath)) return false;
      const pkg = readJson(manifestPath);
      return pkg.private !== true && pkg.exports != null;
    });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function syncPackageManifest(packageDir, { write = false } = {}) {
  const manifestPath = join(packageDir, "package.json");
  const descriptorPath = join(packageDir, DESCRIPTOR_FILE);
  const pkg = readJson(manifestPath);
  const descriptor = readJson(descriptorPath);
  if (descriptor.package !== pkg.name) {
    throw new Error(`${descriptorPath}: package must equal ${pkg.name}`);
  }
  const generated = exportsFromDescriptor(descriptor);
  const next = structuredClone(pkg);
  next.exports = generated.local;
  const needsPublishedExports = Object.values(descriptor.subpaths).some(
    (contract) => contract.source !== primaryRuntime(contract.runtime),
  );
  if (needsPublishedExports) {
    next.publishConfig ??= {};
    next.publishConfig.exports = generated.published;
  } else if (next.publishConfig?.exports) {
    delete next.publishConfig.exports;
  }
  const expected = stableJson(next);
  const actual = readFileSync(manifestPath, "utf8");
  if (actual === expected) return false;
  if (!write) throw new Error(`${manifestPath} is out of sync; run bun run sync:package-subpaths`);
  writeFileSync(manifestPath, expected);
  return true;
}

function bootstrap(packageDir) {
  const manifestPath = join(packageDir, "package.json");
  const pkg = readJson(manifestPath);
  writeFileSync(join(packageDir, DESCRIPTOR_FILE), stableJson(descriptorFromManifest(pkg)));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const packageDirs = listPublicWorkspacePackageDirs();
  if (args.has("--bootstrap")) packageDirs.forEach(bootstrap);
  const changed = packageDirs.filter((packageDir) =>
    syncPackageManifest(packageDir, { write: args.has("--write") || args.has("--bootstrap") }),
  );
  const action = args.has("--write") || args.has("--bootstrap") ? "synchronized" : "verified";
  console.log(
    `Package subpaths ${action}: ${packageDirs.length} public workspaces${changed.length ? ` (${changed.length} updated)` : ""}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

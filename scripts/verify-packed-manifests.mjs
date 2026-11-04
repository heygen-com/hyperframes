#!/usr/bin/env node
// The verifier normalizes conditional exports and materializes multi-runtime
// fixtures; its branch matrix is covered by focused tests plus the live pack gate.
// fallow-ignore-file complexity

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { extname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const RUNTIME_IMPORT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".wasm", ".node"]);
const PACKED_JAVASCRIPT_FILE_PATTERN = /\.(?:js|mjs|cjs)$/;
const SIZE_BUDGETS_FILE = "scripts/package-size-budgets.json";
// A budget sits 5% above the measured size; a package that shrinks 15% below
// its budget fails until the budget follows it down, so budgets only ratchet down.
// A few hundred bytes over the budget is not bloat: only more than 1% over fails.
const SIZE_BUDGET_HEADROOM = 1.05;
const SIZE_BUDGET_RATCHET = 0.85;
const SIZE_BUDGET_TOLERANCE = 1.01;

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
    /^\s*(?:import|export)\b(?:(?!;)[\s\S])*?\s+from\s+["'](\.\.?\/[^"']+)["']/gm,
    /\bimport\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/gm,
    /\brequire\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/gm,
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

function resolvePackedRelativeImport(fromFile, specifier) {
  return posix.normalize(posix.join(posix.dirname(fromFile), stripSpecifierQuery(specifier)));
}

export function listPackedJavaScriptImportIssues(filename, packedFiles) {
  return [...packedFiles]
    .filter((file) => PACKED_JAVASCRIPT_FILE_PATTERN.test(file))
    .flatMap((file) => {
      const source = readPackedFile(filename, file);
      return listRelativeImportSpecifiers(source).flatMap(({ index, specifier }) => {
        if (!hasExplicitRuntimeExtension(specifier)) {
          return [`${file}:${lineNumberAt(source, index)} imports ${specifier}`];
        }

        const target = resolvePackedRelativeImport(file, specifier);
        if (!packedFiles.has(target)) {
          return [`${file}:${lineNumberAt(source, index)} imports missing ${specifier}`];
        }

        return [];
      });
    });
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

export function verifyCliLicense(workspace, sourcePackage, packedPackage) {
  if (workspace !== "packages/cli") return;

  const expectedLicense = "Apache-2.0";
  if (sourcePackage.license !== expectedLicense) {
    throw new Error(`${workspace} must declare license ${expectedLicense}`);
  }
  if (packedPackage.license !== sourcePackage.license) {
    throw new Error(`${workspace} packed manifest must preserve license ${expectedLicense}`);
  }
}

function assertNoWorkspaceRefs(workspace, packedPackage) {
  const packedRefs = listWorkspaceRefs(packedPackage);
  if (packedRefs.length === 0) return;

  throw new Error(
    `Packed manifest for ${workspace} still contains workspace refs: ${packedRefs.join(", ")}`,
  );
}

function verifyPackedWorkspace(workspace, sourcePackage, filename) {
  const packedPackage = readPackedPackage(filename);
  const packedFiles = listPackedFiles(filename);

  verifyCliLicense(workspace, sourcePackage, packedPackage);
  assertNoWorkspaceRefs(workspace, packedPackage);
  verifyPackedEntrypoints(workspace, packedPackage, packedFiles);
  verifyPackedJavaScriptImports(workspace, filename, packedFiles);
}

export function packageExportSpecifier(packageName, exportKey) {
  return exportKey === "." ? packageName : `${packageName}/${exportKey.replace(/^\.\//, "")}`;
}

export function listPackedExportContracts(packedWorkspaces) {
  return packedWorkspaces.flatMap(({ workspace, packedPackage, descriptor }) => {
    const sourceDescriptor =
      descriptor ??
      (workspace && existsSync(join(ROOT, workspace, "package-subpaths.json"))
        ? JSON.parse(readFileSync(join(ROOT, workspace, "package-subpaths.json"), "utf8"))
        : null);
    return Object.entries(packedPackage.exports ?? {}).map(([exportKey, target]) => ({
      specifier: packageExportSpecifier(packedPackage.name, exportKey),
      typechecked: Boolean(target?.types),
      environments: sourceDescriptor?.subpaths?.[exportKey]?.environments ?? ["browser", "node"],
    }));
  });
}

/** Render browser imports as live namespace bindings so sideEffects:false cannot erase the gate. */
export function renderBrowserConsumer(specifiers) {
  const bindings = specifiers.map((_, index) => `packedBrowserModule${index}`);
  const imports = specifiers.map(
    (specifier, index) => `import * as ${bindings[index]} from ${JSON.stringify(specifier)};`,
  );
  return [
    ...imports,
    `const packedBrowserModules = [${bindings.join(", ")}];`,
    `console.log("Packed browser exports", packedBrowserModules.map((module) => Object.keys(module)));`,
    "",
  ].join("\n");
}

/** Name every typed export in a type-only import: a bare `import "x"` lets tsc skip unresolved targets. */
export function renderTypeConsumer(specifiers) {
  return `${specifiers
    .map(
      (specifier, index) =>
        `import type * as packedTypes${index} from ${JSON.stringify(specifier)};`,
    )
    .join("\n")}\nexport {};\n`;
}

/** Strict Node ESM, with declarations checked: skipLibCheck hides unresolvable imports inside .d.ts files. */
export const CONSUMER_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ESNext", "DOM", "DOM.Iterable"],
    types: ["node"],
    strict: true,
    skipLibCheck: false,
    noEmit: true,
  },
  include: ["consumer.ts"],
};

/** Count tsc errors by the installed package they come from, so a failure names its owner. */
export function countTypeErrorsByPackage(output) {
  const counts = {};
  for (const line of output.split("\n")) {
    const match = /^(\S+?)\(\d+,\d+\): error TS\d+/.exec(line);
    if (!match) continue;
    const owner = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(match[1])?.[1] ?? match[1];
    counts[owner] = (counts[owner] ?? 0) + 1;
  }
  return counts;
}

function typecheckPackedConsumer(fixtureDir) {
  try {
    execFileSync(process.execPath, [join(fixtureDir, "node_modules", "typescript", "bin", "tsc")], {
      cwd: fixtureDir,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const counts = Object.entries(countTypeErrorsByPackage(output))
      .map(([owner, count]) => `${owner}: ${count}`)
      .join(", ");
    throw new Error(
      `Packed declarations fail a NodeNext consumer (module/moduleResolution nodenext, skipLibCheck false). ` +
        `Errors by package: ${counts || "unknown"}\n${output.split("\n").slice(0, 20).join("\n")}`,
    );
  }
}

function writeConsumerFixture(packDir, packedWorkspaces) {
  const fixtureDir = join(packDir, "consumer");
  mkdirSync(fixtureDir);
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const workspaceFileDeps = Object.fromEntries(
    packedWorkspaces.map(({ filename, packedPackage }) => [packedPackage.name, `file:${filename}`]),
  );
  const dependencies = { ...workspaceFileDeps };
  // Execute optional integration subpaths (for example aws-lambda/cdk) with
  // their declared peer contract satisfied, exactly as an adopter would.
  for (const { packedPackage } of packedWorkspaces) {
    for (const [peer, version] of Object.entries(packedPackage.peerDependencies ?? {})) {
      dependencies[peer] ??= version;
    }
  }
  dependencies.typescript = rootPackage.devDependencies.typescript;
  dependencies["@types/node"] = rootPackage.devDependencies["@types/node"];
  const studioPackage = JSON.parse(
    readFileSync(join(ROOT, "packages/studio/package.json"), "utf8"),
  );
  dependencies.vite = studioPackage.devDependencies.vite;
  // Studio's declarations name React types; a React consumer brings these itself.
  dependencies["@types/react"] = studioPackage.devDependencies["@types/react"];
  dependencies["@types/react-dom"] = studioPackage.devDependencies["@types/react-dom"];
  writeFileSync(
    join(fixtureDir, "package.json"),
    JSON.stringify(
      {
        name: "packed-consumer",
        private: true,
        type: "module",
        dependencies,
        // Each packed tarball pins its inter-@hyperframes deps to the exact
        // release version. On a release bump that version is not on the registry
        // yet, so a plain install fails to resolve those transitive deps. Force
        // every @hyperframes/* to the sibling local tarball so the check is
        // self-contained pre-publish (matches how the packages install together).
        overrides: { ...workspaceFileDeps },
      },
      null,
      2,
    ),
  );

  const contracts = listPackedExportContracts(packedWorkspaces);
  const typedSpecifiers = contracts
    .filter(({ typechecked }) => typechecked)
    .map(({ specifier }) => specifier);
  writeFileSync(join(fixtureDir, "consumer.ts"), renderTypeConsumer(typedSpecifiers));
  writeFileSync(join(fixtureDir, "tsconfig.json"), JSON.stringify(CONSUMER_TSCONFIG, null, 2));

  const specifiers = contracts.map(({ specifier }) => specifier);
  const nodeSpecifiers = contracts
    .filter(({ environments }) => environments.includes("node"))
    .map(({ specifier }) => specifier);
  const browserSpecifiers = contracts
    .filter(({ environments, typechecked }) => environments.includes("browser") && typechecked)
    .map(({ specifier }) => specifier);
  writeFileSync(
    join(fixtureDir, "consumer-smoke.mjs"),
    `import { existsSync } from "node:fs";\n` +
      `import { join } from "node:path";\n` +
      `const specifiers = ${JSON.stringify(specifiers, null, 2)};\n` +
      `const nodeSpecifiers = ${JSON.stringify(nodeSpecifiers, null, 2)};\n` +
      `for (const specifier of specifiers) import.meta.resolve(specifier);\n` +
      `for (const specifier of nodeSpecifiers) {\n` +
      `  const options = specifier.endsWith(".json") ? { with: { type: "json" } } : undefined;\n` +
      `  await import(specifier, options);\n` +
      `}\n` +
      `const terraform = await import("@hyperframes/gcp-cloud-run/terraform");\n` +
      `if (!existsSync(join(terraform.getTerraformModuleDir(), "main.tf"))) throw new Error("packed Terraform module missing");\n` +
      `console.log(\`Resolved \${specifiers.length} packed exports and executed \${nodeSpecifiers.length} Node exports.\`);\n` +
      `process.exit(0);\n`,
  );
  writeFileSync(join(fixtureDir, "browser-consumer.ts"), renderBrowserConsumer(browserSpecifiers));
  writeFileSync(
    join(fixtureDir, "vite.config.mjs"),
    `import { defineConfig } from "vite";\n` +
      `export default defineConfig({ build: { lib: { entry: "browser-consumer.ts", formats: ["es"] }, outDir: "browser-dist" } });\n`,
  );
  return fixtureDir;
}

// npm lists a new version before every mirror serves its tarball, so resolving one published minutes ago
// can 404 and fail the install. The consumer gets the third-party versions that were on npm a day ago.
export const CONSUMER_MIN_RELEASE_AGE_SECONDS = 24 * 60 * 60;

const BLOCKED_BY_AGE =
  /No version matching "([^"]+)" found for specifier "([^"]+)" \(blocked by minimum-release-age/g;

/** Packages bun refused as too new, or null when its output does not pair a name with a range. */
export function ageBlockedPackages(stderr) {
  const names = [...stderr.matchAll(BLOCKED_BY_AGE)].map(([, a, b]) =>
    [a, b].find((name) => stderr.includes(`${name}@${name === a ? b : a} failed to resolve`)),
  );
  return names.length && names.every(Boolean) ? names : null;
}

export function installConsumer(dir, { args = [], env = process.env } = {}) {
  const install = () =>
    execFileSync(
      "bun",
      [
        "install",
        "--ignore-scripts",
        `--minimum-release-age=${CONSUMER_MIN_RELEASE_AGE_SECONDS}`,
        ...args,
      ],
      { cwd: dir, encoding: "utf8", stdio: "pipe", env },
    );
  try {
    install();
  } catch (error) {
    // A same-day dependency bump: every version its range allows is younger than the age, and the repo
    // installed it already, so its tarball is served. Only those packages skip the age.
    const blocked = ageBlockedPackages(`${error.stderr ?? ""}`);
    if (!blocked) throw error;
    console.log(`Consumer install: newer than the release age, allowed: ${blocked.join(", ")}`);
    writeFileSync(
      join(dir, "bunfig.toml"),
      `[install]\nminimumReleaseAgeExcludes = ${JSON.stringify(blocked)}\n`,
    );
    install();
  }
}

function verifyPackedConsumer(packDir, packedWorkspaces) {
  const fixtureDir = writeConsumerFixture(packDir, packedWorkspaces);
  installConsumer(fixtureDir);
  typecheckPackedConsumer(fixtureDir);
  const smokeOutput = execFileSync("node", ["consumer-smoke.mjs"], {
    cwd: fixtureDir,
    encoding: "utf8",
  });
  execFileSync(join(fixtureDir, "node_modules", ".bin", "vite"), ["build"], {
    cwd: fixtureDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  const cliOutput = execFileSync(
    join(fixtureDir, "node_modules", ".bin", "hyperframes"),
    ["--help"],
    {
      cwd: fixtureDir,
      encoding: "utf8",
      env: { ...process.env, HYPERFRAMES_TELEMETRY_DISABLED: "1" },
    },
  );
  if (!cliOutput.toLowerCase().includes("hyperframes")) {
    throw new Error("Packed CLI help did not identify HyperFrames");
  }
  console.log(smokeOutput.trim());
  console.log(
    "Verified clean packed consumer install, Node execution, NodeNext declaration check, Vite resolution, and CLI startup.",
  );
}

function measurePackedSize(filename) {
  return {
    packed: statSync(filename).size,
    unpacked: execFileSync("tar", ["-xOf", filename], { cwd: ROOT, maxBuffer: 1 << 30 }).length,
  };
}

export function listPackageSizeIssues(name, sizes, budget) {
  const suggest = (bytes) => Math.ceil(bytes * SIZE_BUDGET_HEADROOM);
  if (!budget) {
    return [
      `${name} has no size budget: add "${name}": { "packed": ${suggest(sizes.packed)}, "unpacked": ${suggest(sizes.unpacked)} } to ${SIZE_BUDGETS_FILE}`,
    ];
  }
  return ["packed", "unpacked"].flatMap((kind) => {
    if (!Number.isFinite(budget[kind]) || budget[kind] <= 0) {
      return [`${name} has an invalid ${kind} budget in ${SIZE_BUDGETS_FILE}: use a byte count.`];
    }
    if (sizes[kind] > budget[kind] * SIZE_BUDGET_TOLERANCE) {
      return [
        `${name} ${kind} size ${sizes[kind]} bytes is over its budget of ${budget[kind]} by more than 1%. Keep source maps, tests and unused assets out of the tarball; raise the budget in ${SIZE_BUDGETS_FILE} only with the reason in the PR.`,
      ];
    }
    if (sizes[kind] < budget[kind] * SIZE_BUDGET_RATCHET) {
      return [
        `${name} ${kind} size ${sizes[kind]} bytes is well under its budget of ${budget[kind]}: lower it to ${suggest(sizes[kind])} in ${SIZE_BUDGETS_FILE} so the saving stays.`,
      ];
    }
    return [];
  });
}

function verifyPackageSizes(packedWorkspaces) {
  const budgets = JSON.parse(readFileSync(join(ROOT, SIZE_BUDGETS_FILE), "utf8"));
  const issues = packedWorkspaces.flatMap(({ filename, packedPackage }) =>
    listPackageSizeIssues(
      packedPackage.name,
      measurePackedSize(filename),
      budgets[packedPackage.name],
    ),
  );
  if (issues.length > 0) throw new Error(`Package size budgets:\n${issues.join("\n")}`);
  console.log(`Verified ${packedWorkspaces.length} packages are within their size budgets.`);
}

function packAndVerifyWorkspace(workspace, packDir) {
  const sourcePackageJson = readWorkspacePackage(workspace);
  if (sourcePackageJson.private) return null;

  assertPublishedExportsMatchSource(workspace, sourcePackageJson);
  const filename = packWorkspace(workspace, packDir);
  verifyPackedWorkspace(workspace, sourcePackageJson, filename);
  const packedPackage = readPackedPackage(filename);
  console.log(`Verified ${workspace}: packed manifest is publish-safe.`);
  return { workspace, filename, packedPackage };
}

const LAMBDA_PIN_ASSETS = [
  { asset: "hyperframes-lambda-handler.zip", flags: [] },
  { asset: "hyperframes-lambda-video-arm64.oci.tar", flags: ["--video-image"] },
];

// The publish job pins the Lambda release assets before this check. Anywhere else, sparse stand-ins of release
// size go through the same pin script, so the size check packs the file list a release publishes. Files a
// developer already built (zip, image, their hashes and pins) are moved aside first and put back by the cleanup.
function pinStandInLambdaAssets() {
  const lambda = join(PACKAGES_DIR, "aws-lambda");
  const prebuilt = join(lambda, "prebuilt");
  if (existsSync(join(prebuilt, "handler-zip.json"))) return () => {};
  const dist = join(ROOT, "dist");
  mkdirSync(dist, { recursive: true });
  const built = join(lambda, "dist", "handler.zip");
  const stands = LAMBDA_PIN_ASSETS.flatMap(({ asset }) => [
    join(dist, asset),
    join(dist, `${asset.split(".")[0]}.sha256`),
  ]);
  const pins = [join(prebuilt, "handler-zip.json"), join(prebuilt, "video-image.json")];
  const aside = mkdtempSync(join(dist, "aside-"));
  const moved = [built, `${built}.manifest.json`, ...stands, ...pins]
    .filter((path) => existsSync(path))
    .map((path, index) => {
      const to = join(aside, String(index));
      renameSync(path, to);
      return [path, to];
    });
  const restore = () => {
    [...stands, ...pins].forEach((path) => rmSync(path, { force: true }));
    moved.forEach(([path, to]) => renameSync(to, path));
    rmSync(aside, { force: true, recursive: true });
  };
  try {
    for (const { asset, flags } of LAMBDA_PIN_ASSETS) {
      const path = join(dist, asset);
      writeFileSync(path, "");
      truncateSync(path, 150_000_000);
      execFileSync("bun", [join(lambda, "scripts", "pin-handler-zip.ts"), ...flags], {
        cwd: ROOT,
        stdio: "ignore",
      });
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

/** Copy the packed tarballs out of the temp pack directory, for a job that uploads them. */
export function keepPackedTarballs(packDir, keepDir) {
  mkdirSync(keepDir, { recursive: true });
  for (const name of readdirSync(packDir).filter((file) => file.endsWith(".tgz"))) {
    copyFileSync(join(packDir, name), join(keepDir, name));
  }
}

function main() {
  const packDir = mkdtempSync(join(tmpdir(), "hyperframes-pack-"));
  const unpinLambda = pinStandInLambdaAssets();
  try {
    const packedWorkspaces = listWorkspacePackageDirs()
      .map((workspace) => packAndVerifyWorkspace(workspace, packDir))
      .filter(Boolean);
    verifyPackedConsumer(packDir, packedWorkspaces);
    verifyPackageSizes(packedWorkspaces);
    if (process.env.PACK_KEEP_DIR) keepPackedTarballs(packDir, process.env.PACK_KEEP_DIR);
  } finally {
    unpinLambda();
    rmSync(packDir, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

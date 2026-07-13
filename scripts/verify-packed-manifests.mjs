#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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
  return packedWorkspaces.flatMap(({ packedPackage }) =>
    Object.entries(packedPackage.exports ?? {}).map(([exportKey, target]) => ({
      specifier: packageExportSpecifier(packedPackage.name, exportKey),
      typechecked: Boolean(target?.types),
    })),
  );
}

function writeConsumerFixture(packDir, packedWorkspaces) {
  const fixtureDir = join(packDir, "consumer");
  mkdirSync(fixtureDir);
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const dependencies = Object.fromEntries(
    packedWorkspaces.map(({ filename, packedPackage }) => [packedPackage.name, `file:${filename}`]),
  );
  dependencies.typescript = rootPackage.devDependencies.typescript;
  dependencies["@types/node"] = rootPackage.devDependencies["@types/node"];
  writeFileSync(
    join(fixtureDir, "package.json"),
    JSON.stringify(
      { name: "packed-consumer", private: true, type: "module", dependencies },
      null,
      2,
    ),
  );

  const contracts = listPackedExportContracts(packedWorkspaces);
  const typeImports = contracts
    .filter(({ typechecked }) => typechecked)
    .map(({ specifier }) => `import ${JSON.stringify(specifier)};`)
    .join("\n");
  writeFileSync(join(fixtureDir, "consumer.ts"), `${typeImports}\n`);
  writeFileSync(
    join(fixtureDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    ),
  );

  const specifiers = contracts.map(({ specifier }) => specifier);
  writeFileSync(
    join(fixtureDir, "consumer-smoke.mjs"),
    `const specifiers = ${JSON.stringify(specifiers, null, 2)};\n` +
      `for (const specifier of specifiers) import.meta.resolve(specifier);\n` +
      `const sdk = await import("@hyperframes/sdk");\n` +
      `if (typeof sdk.openComposition !== "function") throw new Error("SDK root export missing");\n` +
      `const memory = await import("@hyperframes/sdk/adapters/memory");\n` +
      `if (typeof memory.createMemoryAdapter !== "function") throw new Error("memory adapter missing");\n` +
      `const fsAdapter = await import("@hyperframes/sdk/adapters/fs");\n` +
      `if (typeof fsAdapter.createFsAdapter !== "function") throw new Error("fs adapter missing");\n` +
      `await import("@hyperframes/core");\n` +
      `await import("@hyperframes/parsers");\n` +
      `await import("@hyperframes/lint");\n` +
      `await import("@hyperframes/studio-server");\n` +
      `console.log(\`Resolved \${specifiers.length} packed exports and loaded public SDK adapters.\`);\n`,
  );
  return fixtureDir;
}

function verifyPackedConsumer(packDir, packedWorkspaces) {
  const fixtureDir = writeConsumerFixture(packDir, packedWorkspaces);
  execFileSync("bun", ["install", "--ignore-scripts"], {
    cwd: fixtureDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  execFileSync(process.execPath, [join(fixtureDir, "node_modules", "typescript", "bin", "tsc")], {
    cwd: fixtureDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  const smokeOutput = execFileSync("node", ["consumer-smoke.mjs"], {
    cwd: fixtureDir,
    encoding: "utf8",
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
  console.log("Verified clean packed consumer install, type resolution, and CLI startup.");
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

function main() {
  const packDir = mkdtempSync(join(tmpdir(), "hyperframes-pack-"));
  try {
    const packedWorkspaces = listWorkspacePackageDirs()
      .map((workspace) => packAndVerifyWorkspace(workspace, packDir))
      .filter(Boolean);
    verifyPackedConsumer(packDir, packedWorkspaces);
  } finally {
    rmSync(packDir, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

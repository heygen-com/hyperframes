// package-loader — bootstrap optional helper packages only when missing, with
// defense-in-depth so a malicious or typo'd dependency can't run on install:
//   • specs are version-pinned (assertPinnedPackageSpecs) — no floating "latest"
//   • install runs `npm install --ignore-scripts` — package lifecycle scripts
//     never execute
//   • `--no-save` into a throwaway tmp dir — the host project is left untouched
//   • requires an interactive y/N (or an explicit $HYPERFRAMES_SKILL_BOOTSTRAP_DEPS=1)
//   • npm is spawned with an argv array (no shell) — never a built command string
// The `installLine` strings below are DISPLAY ONLY (shown in the prompt / error
// text); they are never handed to a shell or executed.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, parse, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION_OVERRIDE_ENV = "HYPERFRAMES_SKILL_PKG_VERSION";
const BOOTSTRAP_ENV = "HYPERFRAMES_SKILL_DEPS_BOOTSTRAPPED";
const BOOTSTRAP_CONFIRM_ENV = "HYPERFRAMES_SKILL_BOOTSTRAP_DEPS";
const NODE_MODULES_ENV = "HYPERFRAMES_SKILL_NODE_MODULES";

export async function importPackagesOrBootstrap(packageNames, options = {}) {
  const entries = new Map();
  const missing = [];

  for (const packageName of packageNames) {
    const entry = resolvePackageEntry(packageName);
    if (entry) entries.set(packageName, entry);
    else missing.push(packageName);
  }

  if (missing.length > 0 && !process.env[BOOTSTRAP_ENV]) {
    const npmPackages = options.npmPackages ?? missing;
    assertPinnedPackageSpecs(npmPackages);
    await confirmBootstrap(npmPackages);
    bootstrapWithNpmInstall(npmPackages);
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Could not resolve required package(s): ${missing.join(", ")}`,
        "Install them in this project, for example:",
        `  npm install --save-dev ${packageNames.map(shellQuote).join(" ")}`,
      ].join("\n"),
    );
  }

  const modules = {};
  for (const [packageName, entry] of entries) {
    modules[packageName] = await import(pathToFileURL(entry).href);
  }
  return modules;
}

export async function bundleCompositionForCapture(compiler, projectDir) {
  const compiledDir = mkdtempSync(join(tmpdir(), "hyperframes-skill-bundle-"));
  try {
    const html = await compiler.bundleToSingleHtml(projectDir);
    writeFileSync(join(compiledDir, "index.html"), html);
    return {
      compiledDir,
      cleanup() {
        rmSync(compiledDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(compiledDir, { recursive: true, force: true });
    throw error;
  }
}

export function hyperframesPackageSpec(packageName) {
  const override = process.env[VERSION_OVERRIDE_ENV]?.trim();
  if (override) return `${packageName}@${override}`;

  const version = readBundledHyperframesVersion();
  if (version) return `${packageName}@${version}`;

  // Global skill installs (e.g. ~/.claude/skills) have no hyperframes package.json
  // in their ancestor chain, so the bundled version is unknowable. Fall back to
  // @latest instead of throwing: already-installed packages still import, and a
  // bootstrap install can still proceed (@latest satisfies the pinned-spec guard).
  process.stderr.write(
    [
      `hyperframes: could not determine the bundled version for ${packageName}; using @latest.`,
      `Set ${VERSION_OVERRIDE_ENV}=<version> to pin it.`,
      "",
    ].join("\n"),
  );
  return `${packageName}@latest`;
}

function resolvePackageEntry(packageName) {
  const bases = [process.cwd(), HERE, ...envNodeModulesDirs(), ...nodeModulesDirsFromPath()];
  const { rootName, subpath } = splitPackageSpecifier(packageName);

  const seen = new Set();
  for (const base of bases) {
    const normalized = resolve(base);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    try {
      return createRequire(join(normalized, "__hyperframes_skill_loader__.cjs")).resolve(
        packageName,
      );
    } catch {
      const packageDir = findPackageDir(normalized, rootName);
      const packageEntry = packageDir ? readPackageEntry(packageDir, subpath) : null;
      if (packageEntry) return packageEntry;
    }
  }

  return null;
}

function splitPackageSpecifier(packageName) {
  const segments = packageName.split("/");
  const rootLength = packageName.startsWith("@") ? 2 : 1;
  return {
    rootName: segments.slice(0, rootLength).join("/"),
    subpath: segments.slice(rootLength).join("/"),
  };
}

function readBundledHyperframesVersion() {
  for (const ancestor of ancestors(HERE)) {
    const directVersion = readPackageVersion(join(ancestor, "package.json"));
    if (directVersion) return directVersion;

    const monorepoCliVersion = readPackageVersion(
      join(ancestor, "packages", "cli", "package.json"),
    );
    if (monorepoCliVersion) return monorepoCliVersion;
  }
  return null;
}

function readPackageVersion(packageJsonPath) {
  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (manifest.name === "hyperframes" || manifest.name === "@hyperframes/cli") {
      return typeof manifest.version === "string" ? manifest.version : null;
    }
  } catch {
    // Keep searching ancestor package manifests.
  }
  return null;
}

function envNodeModulesDirs() {
  return (process.env[NODE_MODULES_ENV] ?? "").split(delimiter).filter(Boolean);
}

function nodeModulesDirsFromPath() {
  const dirs = [];
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry.endsWith(`${join("node_modules", ".bin")}`)) continue;
    dirs.push(dirname(entry));
  }
  return dirs;
}

function findPackageDir(base, packageName) {
  const packageSegments = packageName.split("/");
  const roots =
    basename(base) === "node_modules"
      ? [base]
      : ancestors(base).map((ancestor) => join(ancestor, "node_modules"));

  for (const root of roots) {
    const packageDir = join(root, ...packageSegments);
    if (existsSync(join(packageDir, "package.json"))) return packageDir;
  }
  return null;
}

function readPackageEntry(packageDir, subpath = "") {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    const requestedExport = subpath ? manifest.exports?.[`./${subpath}`] : manifest.exports;
    const entry =
      exportEntry(requestedExport) ??
      (!subpath ? (manifest.module ?? manifest.main ?? "index.js") : null);
    if (!entry) return null;
    const entryPath = join(packageDir, entry);
    return existsSync(entryPath) ? entryPath : null;
  } catch {
    return null;
  }
}

function exportEntry(exports) {
  const root =
    typeof exports === "object" && exports !== null ? (exports["."] ?? exports) : exports;
  if (typeof root === "string") return root;
  if (typeof root !== "object" || root === null) return null;
  if (typeof root.import === "string") return root.import;
  if (typeof root.default === "string") return root.default;
  if (typeof root.node === "string") return root.node;
  if (typeof root.node === "object" && root.node !== null) {
    return root.node.import ?? root.node.default ?? null;
  }
  return null;
}

function assertPinnedPackageSpecs(packageSpecs) {
  const unpinned = packageSpecs.filter((spec) => !hasVersionSpec(spec));
  if (unpinned.length === 0) return;
  throw new Error(
    [
      `Refusing to bootstrap unpinned package spec(s): ${unpinned.join(", ")}`,
      "Pass pinned npm package specs, for example:",
      `  ${packageSpecs.map((spec) => (hasVersionSpec(spec) ? spec : `${spec}@<version>`)).join(" ")}`,
    ].join("\n"),
  );
}

function hasVersionSpec(packageSpec) {
  if (packageSpec.startsWith("@")) {
    const slash = packageSpec.indexOf("/");
    return slash !== -1 && packageSpec.indexOf("@", slash + 1) !== -1;
  }
  return packageSpec.includes("@");
}

async function confirmBootstrap(packageSpecs) {
  if (process.env[BOOTSTRAP_CONFIRM_ENV] === "1") return;

  const installLine = `npm install --ignore-scripts --no-save ${packageSpecs.map(shellQuote).join(" ")}`;
  if (!process.stdin.isTTY) {
    throw new Error(
      [
        "Required helper package(s) are missing.",
        "To allow a one-time temporary dependency bootstrap for this run, set:",
        `  ${BOOTSTRAP_CONFIRM_ENV}=1`,
        "The bootstrap command will be:",
        `  ${installLine}`,
      ].join("\n"),
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      [
        "HyperFrames helper package(s) are missing.",
        `Run a temporary install with lifecycle scripts disabled?`,
        `  ${installLine}`,
        "Proceed? [y/N] ",
      ].join("\n"),
    );
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new Error("Dependency bootstrap cancelled.");
    }
  } finally {
    rl.close();
  }
}

function ancestors(start) {
  const dirs = [];
  let current = resolve(start);
  const root = parse(current).root;
  while (current && current !== root) {
    dirs.push(current);
    current = dirname(current);
  }
  dirs.push(root);
  return dirs;
}

function bootstrapWithNpmInstall(packageNames) {
  const installRoot = mkdtempSync(join(tmpdir(), "hyperframes-skill-deps-"));
  const installResult = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--silent",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--no-save",
      "--prefix",
      installRoot,
      ...packageNames,
    ],
    { stdio: "inherit" },
  );

  if (installResult.error) throw installResult.error;
  if (installResult.status !== 0) {
    rmSync(installRoot, { recursive: true, force: true });
    process.exit(installResult.status ?? 1);
  }

  const args = [...process.argv.slice(1)];
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      [BOOTSTRAP_ENV]: "1",
      [NODE_MODULES_ENV]: join(installRoot, "node_modules"),
    },
  });

  rmSync(installRoot, { recursive: true, force: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

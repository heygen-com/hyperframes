import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildNpmCommand } from "./npxCommand.js";

/** Module type of each optional package; the keys are the only names the loader accepts. */
export interface OptionalPackageModules {
  "onnxruntime-node": typeof import("onnxruntime-node");
  "@google/genai": typeof import("@google/genai");
}

export type OptionalPackage = keyof OptionalPackageModules;

/** Installed on first use instead of with the CLI: their dependency trees carry deprecated packages. */
export const OPTIONAL_PACKAGES = {
  "onnxruntime-node": "1.21.1",
  "@google/genai": "1.52.0",
} as const satisfies Record<OptionalPackage, string>;

const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "optional");

export interface OptionalPackageDeps {
  cacheDir: string;
  /** The package's exports when already installed in `dir`, else null. */
  loadInstalled(dir: string, name: string): unknown | null;
  /** Install `name@version` into `dir`; rejects with npm's output on failure. */
  install(dir: string, name: string, version: string): Promise<void>;
  log(line: string): void;
}

/** One directory per package and version, so a version bump never reads a stale install. */
export function optionalPackageDir(name: OptionalPackage, cacheDir = CACHE_DIR): string {
  return join(cacheDir, `${name.replace("/", "__")}@${OPTIONAL_PACKAGES[name]}`);
}

/** Installed version, or null. Reads the manifest only, so it never loads a native binding. */
export function installedOptionalPackageVersion(
  name: OptionalPackage,
  cacheDir = CACHE_DIR,
): string | null {
  const manifest = join(optionalPackageDir(name, cacheDir), "node_modules", name, "package.json");
  if (!existsSync(manifest)) return null;
  return (JSON.parse(readFileSync(manifest, "utf-8")) as { version: string }).version;
}

/**
 * Load an optional package, installing it once on first use. No prompt: agents run headless.
 * Throws an error that names the manual command when the install cannot complete.
 */
export async function loadOptionalPackage<N extends OptionalPackage>(
  name: N,
  feature: string,
  deps: OptionalPackageDeps = defaultDeps,
): Promise<OptionalPackageModules[N]> {
  const dir = optionalPackageDir(name, deps.cacheDir);
  const installed = deps.loadInstalled(dir, name);
  if (installed !== null) return installed as OptionalPackageModules[N];

  const version = OPTIONAL_PACKAGES[name];
  deps.log(`installing ${name} for ${feature}, once`);
  try {
    await deps.install(dir, name, version);
  } catch (err) {
    const reason = (err as Error).message.trim().split("\n")[0];
    throw new Error(
      `${feature} needs ${name}, and installing it failed (${reason}). ` +
        `Check your network connection, then retry, or install it yourself: npm install ${name}@${version} --prefix "${dir}"`,
    );
  }
  const loaded = deps.loadInstalled(dir, name);
  if (loaded === null) {
    throw new Error(`${name}@${version} installed into ${dir} but could not be loaded.`);
  }
  return loaded as OptionalPackageModules[N];
}

function isInstalled(dir: string, name: string): boolean {
  return existsSync(join(dir, "node_modules", name, "package.json"));
}

function loadInstalled(dir: string, name: string): unknown | null {
  if (!isInstalled(dir, name)) return null;
  return createRequire(join(dir, "package.json"))(name);
}

function runNpm(args: string[]): Promise<void> {
  const npm = buildNpmCommand(args);
  const child = spawn(npm.command, npm.args, { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(output || `npm exited with code ${code}`)),
    );
  });
}

/** Removes a prior pid's abandoned staging dir left by a crash or a kill mid-install. */
function sweepStaleStaging(dir: string): void {
  const prefix = `${basename(dir)}.tmp-`;
  const parent = dirname(dir);
  if (!existsSync(parent)) return;
  for (const entry of readdirSync(parent)) {
    if (entry.startsWith(prefix) && entry !== `${prefix}${process.pid}`) {
      rmSync(join(parent, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Installs into a sibling staging dir, then renames, so `dir` only ever holds a complete install.
 * No cross-process lock: two first runs both download and the loser discards its copy.
 */
async function install(dir: string, name: string, version: string): Promise<void> {
  sweepStaleStaging(dir);
  const staging = `${dir}.tmp-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "package.json"), "{}");
  try {
    await runNpm([
      "install",
      `${name}@${version}`,
      "--prefix",
      staging,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      // A first-use install is interactive, not a CI resolve: fail fast and name the
      // manual command instead of sitting through npm's default multi-minute backoff.
      "--fetch-retries=0",
      "--fetch-timeout=20000",
    ]);
    if (isInstalled(dir, name)) return;
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
  } catch (err) {
    if (!isInstalled(dir, name)) throw err;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const defaultDeps: OptionalPackageDeps = {
  cacheDir: CACHE_DIR,
  loadInstalled,
  install,
  log: (line) => console.error(line),
};

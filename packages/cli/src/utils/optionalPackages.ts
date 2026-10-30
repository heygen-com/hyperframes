import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
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

export const PINNED_PACKAGES = {
  ...OPTIONAL_PACKAGES,
  "sherpa-onnx-node": "1.13.8",
} as const;

type PinnedPackage = keyof typeof PINNED_PACKAGES;

export const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "optional");

/** Installed on first use only when a host bundled the CLI without its sharp dependency. */
export const SHARP_VERSION = "0.35.3";

type FirstUsePackage = OptionalPackage | "sharp";

export interface OptionalPackageDeps {
  cacheDir: string;
  loadBesideCli(name: FirstUsePackage): unknown | null;
  /** The package's exports when already installed in `dir`, else null. */
  loadInstalled(dir: string, name: string): unknown | null;
  /** Install `name@version` into `dir`; rejects with npm's output on failure. */
  install(dir: string, name: string, version: string): Promise<void>;
  log(line: string): void;
}

/** One directory per package and version, so a version bump never reads a stale install. */
export function optionalPackageDir(name: FirstUsePackage, cacheDir = CACHE_DIR): string {
  return join(cacheDir, `${name.replace("/", "__")}@${versionOf(name)}`);
}

function versionOf(name: FirstUsePackage): string {
  return name === "sharp" ? SHARP_VERSION : OPTIONAL_PACKAGES[name];
}

/** Installed version, or null. Reads the manifest only, so it never loads a native binding. */
export function installedOptionalPackageVersion(
  name: OptionalPackage,
  cacheDir = CACHE_DIR,
  cliUrl = import.meta.url,
): string | null {
  if (pinnedPackageBesideCli(name, cliUrl)?.resolution === "entry") return OPTIONAL_PACKAGES[name];
  const dir = optionalPackageDir(name, cacheDir);
  try {
    const manifest: unknown = JSON.parse(readFileSync(manifestPath(dir, name), "utf-8"));
    if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) return null;
    const version = manifest.version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

export function loadInstalledOptionalPackage<N extends OptionalPackage>(
  name: N,
  deps: OptionalPackageDeps = defaultDeps,
): OptionalPackageModules[N] | null {
  return loadPresent(name, deps) as OptionalPackageModules[N] | null;
}

function loadPresent(name: FirstUsePackage, deps: OptionalPackageDeps): unknown | null {
  return (
    deps.loadBesideCli(name) ?? deps.loadInstalled(optionalPackageDir(name, deps.cacheDir), name)
  );
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
  return (await loadOrInstall(name, feature, deps)) as OptionalPackageModules[N];
}

type Sharp = typeof import("sharp").default;
type FindSharp = (feature: string) => Sharp | null;

export async function loadSharp(
  feature: string,
  deps: OptionalPackageDeps = defaultDeps,
  besideCli: FindSharp = requireSharpBesideCli,
): Promise<Sharp> {
  return besideCli(feature) ?? sharpExport(await loadOrInstall("sharp", feature, deps));
}

let backgroundSharpInstall: Promise<unknown> | undefined;

/** The installed sharp; else rejects now and installs it once in the background for a later call. */
export async function loadSharpInBackground(
  feature: string,
  deps: OptionalPackageDeps = defaultDeps,
  besideCli: FindSharp = requireSharpBesideCli,
): Promise<Sharp> {
  const present = loadInstalledSharp(feature, deps, besideCli);
  if (present !== null) return present;
  const install = loadOrInstall("sharp", feature, deps);
  if (backgroundSharpInstall !== install) {
    backgroundSharpInstall = install;
    install.catch((err: unknown) => deps.log((err as Error).message));
  }
  const notYet = Symbol("installing");
  const settled = await Promise.race([install, notYet]);
  if (settled === notYet)
    throw new Error(`sharp is not installed yet; installing it once for ${feature}`);
  return sharpExport(settled);
}

export function loadInstalledSharp(
  feature: string,
  deps: OptionalPackageDeps = defaultDeps,
  besideCli: FindSharp = requireSharpBesideCli,
): Sharp | null {
  const found = besideCli(feature) ?? loadPresent("sharp", deps);
  return found === null ? null : sharpExport(found);
}

/** Any version counts, found as require finds it (NODE_PATH included). A copy that fails to load throws. */
export function requireSharpBesideCli(feature: string, cliUrl = import.meta.url): Sharp | null {
  const req = createRequire(cliUrl);
  let entry: string;
  try {
    entry = req.resolve("sharp");
  } catch {
    return null;
  }
  try {
    return sharpExport(req(entry));
  } catch (err) {
    throw new Error(
      `${feature} needs sharp, which is installed but could not load (${(err as Error).message}). ` +
        "Reinstall hyperframes with optional dependencies enabled, or run: npm i sharp",
    );
  }
}

function sharpExport(module: unknown): Sharp {
  const m = module as Sharp & { default?: Sharp };
  return m.default ?? m;
}

/** `1` turns off every first-use install; a comma-separated list turns off just those packages. */
function installTurnedOff(name: FirstUsePackage): boolean {
  const value = process.env["HYPERFRAMES_NO_OPTIONAL_INSTALL"]?.trim() ?? "";
  return value === "1" || value.split(",").some((entry) => entry.trim() === name);
}

const installs = new WeakMap<OptionalPackageDeps, Map<FirstUsePackage, Promise<unknown>>>();

/** One install per package per process: concurrent and later callers share its result, failure included. */
function loadOrInstall(
  name: FirstUsePackage,
  feature: string,
  deps: OptionalPackageDeps,
): Promise<unknown> {
  const present = loadPresent(name, deps);
  if (present !== null) return Promise.resolve(present);
  let pending = installs.get(deps);
  if (!pending) installs.set(deps, (pending = new Map()));
  let install = pending.get(name);
  if (!install) pending.set(name, (install = installAndLoad(name, feature, deps)));
  return install;
}

async function installAndLoad(
  name: FirstUsePackage,
  feature: string,
  deps: OptionalPackageDeps,
): Promise<unknown> {
  const dir = optionalPackageDir(name, deps.cacheDir);

  const version = versionOf(name);
  if (installTurnedOff(name)) {
    throw new Error(
      `${name} is not installed, and HYPERFRAMES_NO_OPTIONAL_INSTALL turns off installing it; ${feature} needs it.`,
    );
  }
  deps.log(`installing ${name} for ${feature}, once`);
  try {
    await deps.install(dir, name, version);
  } catch (err) {
    const output = (err as Error).message.trim();
    const advice = NETWORK_FAILURE.test(output)
      ? "Check your network connection, then retry"
      : "Retry";
    throw new Error(
      `${feature} needs ${name}, and installing it failed (${output.split("\n")[0]}). ` +
        `${advice}, or install it yourself: npm install ${name}@${version} --prefix "${dir}"`,
    );
  }
  const loaded = deps.loadInstalled(dir, name);
  if (loaded === null) {
    throw new Error(`${name}@${version} installed into ${dir} but could not be loaded.`);
  }
  return loaded;
}

const NETWORK_FAILURE = /ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|network/i;

function manifestPath(dir: string, name: string): string {
  return join(dir, "node_modules", name, "package.json");
}

export function isInstalled(dir: string, name: string): boolean {
  return existsSync(manifestPath(dir, name));
}

export function installedPackagePath(dir: string, name: string): string | null {
  if (!isInstalled(dir, name)) return null;
  return createRequire(join(dir, "package.json")).resolve(name);
}

function loadInstalled(dir: string, name: string): unknown | null {
  const entry = installedPackagePath(dir, name);
  return entry === null ? null : createRequire(join(dir, "package.json"))(entry);
}

export function pinnedPackageBesideCli(
  name: PinnedPackage,
  cliUrl = import.meta.url,
): { resolution: "entry" | "package"; path: string } | null {
  const req = createRequire(cliUrl);
  const pinnedFolder = (req.resolve.paths(name) ?? []).find((dir) =>
    hasPinnedVersion(join(dir, name), name),
  );
  if (pinnedFolder === undefined) return null;
  const copy = realpathSync(join(pinnedFolder, name));
  const inside = (resolve: () => string) => {
    try {
      const entry = realpathSync(resolve());
      return entry.startsWith(copy + sep) ? entry : null;
    } catch {
      return null;
    }
  };
  const entry =
    inside(() => createRequire(join(copy, "package.json")).resolve(name)) ??
    inside(() => req.resolve(copy));
  return entry ? { resolution: "entry", path: entry } : { resolution: "package", path: copy };
}

function hasPinnedVersion(copy: string, name: PinnedPackage): boolean {
  try {
    const manifest = readFileSync(join(copy, "package.json"), "utf-8");
    return (JSON.parse(manifest) as { version?: string }).version === PINNED_PACKAGES[name];
  } catch {
    return false;
  }
}

export function loadBesideCli(name: PinnedPackage, cliUrl = import.meta.url): unknown | null {
  const copy = pinnedPackageBesideCli(name, cliUrl);
  return copy?.resolution === "entry" ? createRequire(cliUrl)(copy.path) : null;
}

export function runNpm(args: string[], signal?: AbortSignal): Promise<void> {
  const npm = buildNpmCommand(args);
  const child = spawn(npm.command, npm.args, { stdio: ["ignore", "pipe", "pipe"], signal });
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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

const STAGING_PID_TRUSTED_FOR_MS = 6 * 60 * 60 * 1000;

/** Removes staging dirs whose pid is dead (killed install), or too old to trust a live pid (reuse). */
export function sweepStaleStaging(dir: string): void {
  const prefix = `${basename(dir)}.tmp-`;
  const parent = dirname(dir);
  if (!existsSync(parent)) return;
  for (const entry of readdirSync(parent)) {
    if (!entry.startsWith(prefix)) continue;
    const pid = /^(\d+)(?:-|$)/.exec(entry.slice(prefix.length))?.[1];
    if (pid === undefined) continue;
    const stale = join(parent, entry);
    const age = Date.now() - (statSync(stale, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (isProcessAlive(Number(pid)) && age < STAGING_PID_TRUSTED_FOR_MS) continue;
    try {
      rmSync(stale, { recursive: true, force: true });
    } catch (err) {
      // Best effort: a locked stale dir must not block a viable install, but it stays visible.
      console.error(`could not remove stale install dir ${stale}: ${(err as Error).message}`);
    }
  }
}

/**
 * Installs into a sibling staging dir, then renames, so `dir` only ever holds a complete install.
 * No cross-process lock: two first runs both download and the loser discards its copy.
 */
export async function install(
  dir: string,
  name: string,
  version: string,
  run: (args: string[]) => Promise<void> = runNpm,
): Promise<void> {
  sweepStaleStaging(dir);
  const staging = `${dir}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "package.json"), "{}");
  try {
    await run([
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
  loadBesideCli: (name) => (name === "sharp" ? null : loadBesideCli(name)),
  loadInstalled,
  install,
  log: (line) => console.error(line),
};

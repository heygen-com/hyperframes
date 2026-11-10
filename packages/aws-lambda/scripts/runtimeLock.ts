import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeSource = "sparticuz" | "chrome-headless-shell";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const RUNTIME_LOCK_DIR = join(scriptDir, "runtime-lock");
export const BUN_LOCK_PATH = resolve(scriptDir, "../../../bun.lock");
export const RUNTIME_SOURCES: RuntimeSource[] = ["sparticuz", "chrome-headless-shell"];

export function runtimePackages(source: RuntimeSource): string[] {
  return source === "sparticuz" ? ["puppeteer-core", "@sparticuz/chromium"] : ["puppeteer-core"];
}

/** The version bun.lock resolved for a package, or null when it has no entry. */
export function bunLockVersion(lockText: string, moduleName: string): string | null {
  const name = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"${name}":\\s*\\["${name}@([^"]+)"`).exec(lockText)?.[1] ?? null;
}

/**
 * Where the committed lock's direct versions (puppeteer-core, @sparticuz/chromium) disagree with
 * bun.lock; empty when they match. The transitive tree is the lock's own: npm resolves it, and
 * Renovate's lockFileMaintenance refreshes it (see .github/renovate.json), so it can differ from bun.lock.
 */
export function lockMismatches(source: RuntimeSource, bunLockText: string): string[] {
  const lockPath = join(RUNTIME_LOCK_DIR, source, "package-lock.json");
  if (!existsSync(lockPath)) return [`${source}: no committed package-lock.json`];
  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as {
    packages: Record<string, { version?: string }>;
  };
  return runtimePackages(source).flatMap((name) => {
    const want = bunLockVersion(bunLockText, name);
    const locked = lock.packages[`node_modules/${name}`]?.version;
    if (!want) return [`${source}: bun.lock has no entry for ${name}`];
    return locked === want
      ? []
      : [`${source}: ${name} is ${locked ?? "missing"}, bun.lock has ${want}`];
  });
}

/** In the repo, refuses a runtime lock that no longer matches bun.lock; a published package has no bun.lock to compare. */
export function assertRuntimeLockCurrent(source: RuntimeSource): void {
  if (!existsSync(BUN_LOCK_PATH)) return;
  const stale = lockMismatches(source, readFileSync(BUN_LOCK_PATH, "utf-8"));
  if (stale.length > 0) {
    throw new Error(
      `[build-zip] runtime lock is stale (${stale.join("; ")}). ` +
        `Run 'bun packages/aws-lambda/scripts/lock-runtime.ts'.`,
    );
  }
}

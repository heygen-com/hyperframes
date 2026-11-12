/**
 * Regenerates the committed lockfiles the Lambda handler ZIP installs from, one per Chrome source,
 * with puppeteer-core and @sparticuz/chromium at the exact versions bun.lock resolved. npm resolves
 * the transitive tree, and Renovate's weekly lockFileMaintenance keeps it current. Run after
 * bumping puppeteer-core or @sparticuz/chromium:
 *   bun packages/aws-lambda/scripts/lock-runtime.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUN_LOCK_PATH,
  RUNTIME_LOCK_DIR,
  RUNTIME_SOURCES,
  bunLockVersion,
  runtimePackages,
} from "./runtimeLock.js";

const bunLock = readFileSync(BUN_LOCK_PATH, "utf-8");
for (const source of RUNTIME_SOURCES) {
  const dir = join(RUNTIME_LOCK_DIR, source);
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, "package-lock.json"), { force: true });
  const dependencies = Object.fromEntries(
    runtimePackages(source).map((name) => {
      const version = bunLockVersion(bunLock, name);
      if (!version) throw new Error(`[lock-runtime] bun.lock has no entry for ${name}`);
      return [name, version];
    }),
  );
  const pkg = {
    name: "hyperframes-aws-lambda-bundled",
    version: "0.0.0",
    private: true,
    dependencies,
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const result = spawnSync(
    "npm",
    ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: dir, stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`[lock-runtime] npm failed for ${source}`);
  console.log(`[lock-runtime] ${source}: ${JSON.stringify(dependencies)}`);
}

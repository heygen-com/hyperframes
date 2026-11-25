/**
 * Resolve the HyperFrames repo root. Used by `lambda deploy`/`destroy`
 * to find `examples/aws-lambda/template.yaml` and the handler ZIP build
 * script.
 *
 * Only the checkout this CLI itself sits in counts: `<root>/packages/cli`
 * must be the running CLI's own package, and `<root>/packages/aws-lambda`
 * must be the adapter package. Undefined for a published install, where
 * deploy uses the adapter's prebuilt handler.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PACKAGE = "@hyperframes/cli";
const LAMBDA_PACKAGE = "@hyperframes/aws-lambda";

export function repoRoot(
  moduleDir: string = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  const override = process.env.HYPERFRAMES_REPO_ROOT;
  if (override) {
    if (packageName(resolve(override, "packages", "aws-lambda")) === LAMBDA_PACKAGE)
      return override;
    throw new Error(
      "[hyperframes lambda] HYPERFRAMES_REPO_ROOT is not a hyperframes checkout " +
        `(no ${LAMBDA_PACKAGE} package at packages/aws-lambda there). Point it at the repo root, or unset it.`,
    );
  }
  const cliDir = ownPackageDir(moduleDir);
  if (!cliDir || packageName(cliDir) !== CLI_PACKAGE) return undefined;
  const packagesDir = dirname(cliDir);
  if (basename(packagesDir) !== "packages") return undefined;
  const root = dirname(packagesDir);
  return packageName(join(root, "packages", "aws-lambda")) === LAMBDA_PACKAGE ? root : undefined;
}

/** The nearest folder at or above `dir` holding a package.json: this module's own package. */
function ownPackageDir(dir: string): string | undefined {
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function packageName(dir: string): unknown {
  try {
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }).name;
  } catch {
    return undefined;
  }
}

/**
 * Shared Python-runtime probes. Used by Kokoro synthesis (which must
 * actually `import` a module before using it) and by the `auth status` /
 * `doctor` readiness checks (which only need to know whether a module is
 * installed, cheaply, without paying the cost of importing heavy packages
 * like torch).
 */

import { execFileSync } from "node:child_process";

/** Locate a `python3` (or `python`) on PATH that reports as Python 3. */
export function findPython(): string | undefined {
  for (const name of ["python3", "python"]) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const output = execFileSync(cmd, [name], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
      const first = output
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (!first) continue;

      // Verify it's Python 3
      const version = execFileSync(first, ["--version"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      }).trim();

      if (version.includes("Python 3")) return first;
    } catch {
      // not found or not Python 3
    }
  }
  return undefined;
}

/** True if `import <pkg>` succeeds — actually executes the module. */
export function hasPythonPackage(python: string, pkg: string): boolean {
  try {
    execFileSync(python, ["-c", `import ${pkg}`], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * True if every module is installed, checked via `importlib.util.find_spec`
 * so heavy packages (torch) are never imported — fast enough for a preflight.
 * Returns false when no Python 3 is found.
 */
export function hasPythonModules(modules: string[]): boolean {
  const python = findPython();
  if (!python) return false;
  const list = JSON.stringify(modules);
  const probe = `import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in ${list}) else 1)`;
  try {
    execFileSync(python, ["-c", probe], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

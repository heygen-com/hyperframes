/**
 * Shared Python-runtime probes. Used by Kokoro synthesis (which must
 * actually `import` a module before using it) and by the `auth status` /
 * `doctor` readiness checks (which only need to know whether a module is
 * installed, cheaply, without paying the cost of importing heavy packages
 * like torch).
 */

import { execFileSync } from "node:child_process";

type PythonOverrideValidation = { ok: true } | { ok: false; reason: string };

/** Run `<override> --version` and check it reports Python 3, without throwing. */
function validatePythonOverride(override: string): PythonOverrideValidation {
  try {
    const version = execFileSync(override, ["--version"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    if (/Python 3/.test(version)) return { ok: true };
    return {
      ok: false,
      reason: `did not report a Python 3 version (got ${JSON.stringify(version.trim())})`,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Locate a Python 3: `HYPERFRAMES_PYTHON` env override first, then PATH. */
export function findPython(): string | undefined {
  const override = process.env.HYPERFRAMES_PYTHON;
  if (override && validatePythonOverride(override).ok) return override;
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

/**
 * If `HYPERFRAMES_PYTHON` is set but `findPython()` would reject it, describe
 * why. `findPython()` itself silently falls back to the PATH probe on any
 * rejection (nonexistent path, non-executable, non-Python-3 output, timeout)
 * with no diagnostic — a readiness check like `doctor` calls this to surface
 * that instead of reporting a plain "not installed" that gives no hint the
 * override was even seen.
 */
export function describeRejectedPythonOverride(): string | null {
  const override = process.env.HYPERFRAMES_PYTHON;
  if (!override) return null;
  const validation = validatePythonOverride(override);
  if (validation.ok) return null;
  return `HYPERFRAMES_PYTHON="${override}" was rejected: ${validation.reason}`;
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

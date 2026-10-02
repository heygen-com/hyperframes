// python.mjs — resolve which Python 3 executable to spawn, per platform.
//
// The audio engine (tts.mjs, bgm.mjs) shells out to `python3` for ElevenLabs
// TTS and the local Lyria/MusicGen BGM paths. `python3` is the right name on
// macOS/Linux, but on Windows the python.org installer only creates
// `python.exe` plus the `py` launcher — there is no `python3.exe` (only the
// Microsoft Store build adds one). So a bare `spawn("python3", …)` ENOENTs on a
// standard Windows Python install, silently disabling every Python-backed audio
// feature until the user hand-creates a `python3.exe` shim (reported twice).
//
// Resolve once, per process: probe the platform's candidates in order and take
// the first that actually runs. `py` is the launcher, so it needs a `-3` arg to
// select Python 3 — hence candidates are argv PREFIXES, not bare names.
//
// `HYPERFRAMES_PYTHON` wins over the PATH probe, matching the CLI's
// `findPython()`. The documented setup on PEP 668 systems (Homebrew Python) is
// a venv pointed to by that variable; without honouring it here, `doctor`
// reports MusicGen installed while BGM silently disables itself (#4614).

import { spawnSync } from "node:child_process";

// Accept only an interpreter whose `--version` reports Python 3, as the CLI's
// `validatePythonOverride()` does. Exit status alone would take a Python 2
// `python` (or any executable that exits 0) that `doctor` rejects. Python 2
// prints its version to stderr, so read both streams.
export function defaultProbe(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: "utf-8", timeout: 5000 });
    return result.status === 0 && /Python 3/.test(`${result.stdout}${result.stderr}`);
  } catch {
    return false;
  }
}

/**
 * Pick the argv prefix that launches Python 3 on this platform.
 * Returns e.g. `["python3"]`, `["python"]`, or `["py", "-3"]`.
 *
 * Pure except for `probe` (which runs `<cmd> … --version`); `platform`,
 * `probe` and `env` are injectable so every branch is unit-testable without
 * spawning. A `HYPERFRAMES_PYTHON` override that isn't a runnable Python 3
 * falls through to the PATH probe, as the CLI does. If nothing probes OK, falls back to the
 * canonical name for the platform so the eventual spawn fails loudly exactly
 * as it did before — never worse.
 */
export function resolvePythonCommand(
  platform = process.platform,
  probe = defaultProbe,
  env = process.env,
) {
  const override = env.HYPERFRAMES_PYTHON;
  if (override && probe(override, ["--version"])) return [override];
  const candidates =
    platform === "win32" ? [["python3"], ["python"], ["py", "-3"]] : [["python3"], ["python"]];
  for (const prefix of candidates) {
    if (probe(prefix[0], [...prefix.slice(1), "--version"])) return prefix;
  }
  return candidates[0];
}

let cached = null;

/** Cached `resolvePythonCommand()` — probing spawns, so resolve at most once. */
export function pythonCommand() {
  if (!cached) cached = resolvePythonCommand();
  return cached;
}

/**
 * Build a `{ cmd, args }` for running Python 3 with `extraArgs`, using the
 * resolved (or supplied) prefix. Keeps the launcher's `-3` (and any future
 * prefix args) ahead of the caller's own arguments.
 */
export function pythonInvocation(extraArgs, prefix = pythonCommand()) {
  return { cmd: prefix[0], args: [...prefix.slice(1), ...extraArgs] };
}

/** Test-only: clear the cached resolution so a test can re-probe. */
export function _resetPythonCommandCacheForTests() {
  cached = null;
}

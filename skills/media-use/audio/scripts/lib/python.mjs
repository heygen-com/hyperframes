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

import { spawnSync } from "node:child_process";

function defaultProbe(cmd, args) {
  try {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Pick the argv prefix that launches Python 3 on this platform.
 * Returns e.g. `["python3"]`, `["python"]`, or `["py", "-3"]`.
 *
 * Pure except for `probe` (which runs `<cmd> … --version`); both `platform`
 * and `probe` are injectable so every branch is unit-testable without spawning.
 * If nothing probes OK, falls back to the canonical name for the platform so
 * the eventual spawn fails loudly exactly as it did before — never worse.
 */
export function resolvePythonCommand(platform = process.platform, probe = defaultProbe) {
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

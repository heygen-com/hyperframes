import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePythonCommand, pythonInvocation } from "./python.mjs";

// Regression: on Windows a standard python.org install has no `python3.exe`
// (only `python.exe` + the `py` launcher), so `spawn("python3", …)` ENOENTs and
// every Python-backed audio feature silently no-ops. resolvePythonCommand takes
// injectable platform/probe params so all branches are testable without
// spawning a real interpreter.

// probeFor(names): a probe that reports success only for the given argv-0 names.
function probeFor(...names) {
  const ok = new Set(names);
  return (cmd) => ok.has(cmd);
}

test("non-win32 uses python3 when it runs", () => {
  assert.deepEqual(resolvePythonCommand("linux", probeFor("python3")), ["python3"]);
  assert.deepEqual(resolvePythonCommand("darwin", probeFor("python3")), ["python3"]);
});

test("win32 prefers python3 when the Microsoft Store build provides it", () => {
  assert.deepEqual(resolvePythonCommand("win32", probeFor("python3", "python", "py")), ["python3"]);
});

test("win32 falls back to python.exe when python3 is absent (python.org install)", () => {
  // The exact reported scenario: no python3, but `python` exists.
  assert.deepEqual(resolvePythonCommand("win32", probeFor("python", "py")), ["python"]);
});

test("win32 falls back to the py launcher with -3 when only py exists", () => {
  assert.deepEqual(resolvePythonCommand("win32", probeFor("py")), ["py", "-3"]);
});

test("py launcher is probed as `py -3 --version`, not bare `py`", () => {
  const seen = [];
  const probe = (cmd, args) => {
    seen.push([cmd, ...args]);
    return cmd === "py";
  };
  resolvePythonCommand("win32", probe);
  assert.deepEqual(seen.at(-1), ["py", "-3", "--version"]);
});

test("falls back to the canonical name (loud failure, unchanged) when nothing runs", () => {
  // No interpreter anywhere — must not throw, and must return python3 so the
  // eventual spawn fails exactly as it did before this fix, never worse.
  assert.deepEqual(
    resolvePythonCommand("win32", () => false),
    ["python3"],
  );
  assert.deepEqual(
    resolvePythonCommand("linux", () => false),
    ["python3"],
  );
});

test("pythonInvocation prepends the resolved prefix ahead of caller args", () => {
  assert.deepEqual(pythonInvocation(["-c", "import x"], ["python"]), {
    cmd: "python",
    args: ["-c", "import x"],
  });
  // The py launcher's -3 must stay ahead of the caller's own arguments.
  assert.deepEqual(pythonInvocation(["-c", "import x"], ["py", "-3"]), {
    cmd: "py",
    args: ["-3", "-c", "import x"],
  });
});

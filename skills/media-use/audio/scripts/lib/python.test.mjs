import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProbe, resolvePythonCommand, pythonInvocation } from "./python.mjs";

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

// Regression (#4614): on PEP 668 systems the documented setup is a venv named
// by HYPERFRAMES_PYTHON; the audio engine ignored it and probed the bare
// system python3, so MusicGen BGM was skipped while `doctor` said installed.
const VENV = "/home/u/.venvs/hf/bin/python";

test("HYPERFRAMES_PYTHON wins over python3 on PATH when it runs", () => {
  const env = { HYPERFRAMES_PYTHON: VENV };
  assert.deepEqual(resolvePythonCommand("darwin", probeFor(VENV, "python3"), env), [VENV]);
  assert.deepEqual(resolvePythonCommand("win32", probeFor(VENV, "python", "py"), env), [VENV]);
});

test("a HYPERFRAMES_PYTHON that doesn't run falls through to the PATH probe", () => {
  const env = { HYPERFRAMES_PYTHON: "/nope/python" };
  assert.deepEqual(resolvePythonCommand("linux", probeFor("python3"), env), ["python3"]);
});

test("an empty HYPERFRAMES_PYTHON is ignored without being probed", () => {
  const seen = [];
  const probe = (cmd) => {
    seen.push(cmd);
    return cmd === "python3";
  };
  assert.deepEqual(resolvePythonCommand("linux", probe, { HYPERFRAMES_PYTHON: "" }), ["python3"]);
  assert.deepEqual(seen, ["python3"]);
});

// defaultProbe must match the CLI's validatePythonOverride(): exiting 0 is not
// enough, `--version` has to report Python 3. Stubs are shell scripts, so
// these run on POSIX only.
function withStub(script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "hf-python-probe-"));
  try {
    const stub = join(dir, "python");
    writeFileSync(stub, `#!/bin/sh\n${script}\n`);
    chmodSync(stub, 0o755);
    fn(stub);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const posixOnly = { skip: process.platform === "win32" && "stub scripts need a POSIX shell" };

test("defaultProbe accepts an interpreter reporting Python 3", posixOnly, () => {
  withStub('echo "Python 3.12.4"', (stub) => assert.equal(defaultProbe(stub, ["--version"]), true));
});

test("defaultProbe rejects Python 2, which prints its version to stderr", posixOnly, () => {
  withStub('echo "Python 2.7.18" >&2', (stub) =>
    assert.equal(defaultProbe(stub, ["--version"]), false),
  );
});

test(
  "defaultProbe rejects an executable that exits 0 without a Python 3 version",
  posixOnly,
  () => {
    withStub("exit 0", (stub) => assert.equal(defaultProbe(stub, ["--version"]), false));
  },
);

test("defaultProbe rejects a command that doesn't exist", () => {
  assert.equal(defaultProbe("/nonexistent/hf-python", ["--version"]), false);
});

const DROP_CWD = "import sys\nif sys.path and sys.path[0] == '': del sys.path[0]\n";

test("pythonInvocation prepends the resolved prefix ahead of caller args", () => {
  assert.deepEqual(pythonInvocation(["-c", "import x"], ["python"]), {
    cmd: "python",
    args: ["-c", `${DROP_CWD}import x`],
  });
  // The py launcher's -3 must stay ahead of the caller's own arguments.
  assert.deepEqual(pythonInvocation(["-c", "import x", "arg"], ["py", "-3"]), {
    cmd: "py",
    args: ["-3", "-c", `${DROP_CWD}import x`, "arg"],
  });
  assert.deepEqual(pythonInvocation(["/abs/script.py", "--flag"], ["python"]), {
    cmd: "python",
    args: ["/abs/script.py", "--flag"],
  });
});

test("pythonInvocation runs modules without the working directory on sys.path", () => {
  const { args } = pythonInvocation(["-m", "pip", "install", "-q", "numpy"], ["python"]);
  assert.deepEqual(args.slice(2), ["install", "-q", "numpy"]);
  assert.equal(args[0], "-c");
  assert.match(
    args[1],
    /^import sys\n.*\nimport runpy\nrunpy\.run_module\("pip", run_name="__main__", alter_sys=True\)\n$/s,
  );
});

function hasPython3() {
  return spawnSync("python3", ["--version"], { encoding: "utf-8" }).status === 0;
}

test("a module planted in the working directory is never imported", { skip: !hasPython3() }, () => {
  const project = mkdtempSync(join(tmpdir(), "hf-py-cwd-"));
  try {
    const marker = join(project, "ran");
    writeFileSync(
      join(project, "hf_probe_module.py"),
      `open(${JSON.stringify(marker)}, "w").write("x")\n`,
    );
    writeFileSync(
      join(project, "hf_probe_main.py"),
      `open(${JSON.stringify(marker)}, "w").write("x")\n`,
    );
    const env = { ...process.env, PYTHONSAFEPATH: "" };
    const inline = pythonInvocation(["-c", "import hf_probe_module"], ["python3"]);
    assert.notEqual(spawnSync(inline.cmd, inline.args, { cwd: project, env }).status, 0);
    const module = pythonInvocation(["-m", "hf_probe_main"], ["python3"]);
    assert.notEqual(spawnSync(module.cmd, module.args, { cwd: project, env }).status, 0);
    assert.equal(existsSync(marker), false);
    const pip = pythonInvocation(["-m", "json.tool", "--help"], ["python3"]);
    assert.equal(spawnSync(pip.cmd, pip.args, { cwd: project, env }).status, 0);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

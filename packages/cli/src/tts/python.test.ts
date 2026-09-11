import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for a silent HYPERFRAMES_PYTHON override rejection:
// findPython() correctly resolves the env override first, but previously
// discarded ANY validation failure (nonexistent path, non-executable,
// non-Python-3 output, timeout) via a bare `catch {}` with zero diagnostic,
// silently falling back to the PATH probe. A user with a subtly wrong
// HYPERFRAMES_PYTHON value had no way to know it was even seen, let alone
// why it was rejected.

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: execFileSyncMock };
});

const { findPython, describeRejectedPythonOverride } = await import("./python.js");

describe("findPython / describeRejectedPythonOverride", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    delete process.env.HYPERFRAMES_PYTHON;
  });

  it("describeRejectedPythonOverride returns null when HYPERFRAMES_PYTHON is unset", () => {
    delete process.env.HYPERFRAMES_PYTHON;
    expect(describeRejectedPythonOverride()).toBeNull();
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("describeRejectedPythonOverride returns null when the override is a valid Python 3", () => {
    process.env.HYPERFRAMES_PYTHON = "/opt/venv/bin/python";
    execFileSyncMock.mockReturnValue("Python 3.11.0");
    expect(describeRejectedPythonOverride()).toBeNull();
  });

  it("describeRejectedPythonOverride names the override and the exception when it cannot run", () => {
    process.env.HYPERFRAMES_PYTHON = "/nonexistent/python";
    execFileSyncMock.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    const message = describeRejectedPythonOverride();
    expect(message).toContain("/nonexistent/python");
    expect(message).toContain("ENOENT");
  });

  it("describeRejectedPythonOverride names the override when --version doesn't report Python 3", () => {
    process.env.HYPERFRAMES_PYTHON = "/opt/venv/bin/python2";
    execFileSyncMock.mockReturnValue("Python 2.7.18");
    const message = describeRejectedPythonOverride();
    expect(message).toContain("/opt/venv/bin/python2");
    expect(message).toContain("Python 2.7.18");
  });

  it("findPython still falls back to the PATH probe when the override is rejected", () => {
    process.env.HYPERFRAMES_PYTHON = "/nonexistent/python";
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === "--version" && cmd === "/nonexistent/python") {
        throw new Error("ENOENT: no such file or directory");
      }
      if (cmd === "which" || cmd === "where") return "/usr/bin/python3\n";
      if (args[0] === "--version") return "Python 3.11.0";
      throw new Error(`unexpected call: ${cmd} ${args.join(" ")}`);
    });
    expect(findPython()).toBe("/usr/bin/python3");
  });

  it("findPython uses the override directly when it validates", () => {
    process.env.HYPERFRAMES_PYTHON = "/opt/venv/bin/python";
    execFileSyncMock.mockReturnValue("Python 3.11.0");
    expect(findPython()).toBe("/opt/venv/bin/python");
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });
});

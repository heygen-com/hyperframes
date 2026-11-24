import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isolatedPythonCode } from "./python.js";

function hasPython3(): boolean {
  try {
    return /Python 3/.test(execFileSync("python3", ["--version"], { encoding: "utf-8" }));
  } catch {
    return false;
  }
}

describe.skipIf(!hasPython3())("isolatedPythonCode", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("does not import a module planted in the working directory", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-py-cwd-"));
    dirs.push(project);
    const marker = join(project, "ran");
    writeFileSync(
      join(project, "hf_probe_module.py"),
      `open(${JSON.stringify(marker)}, "w").write("x")\n`,
    );

    expect(() =>
      execFileSync("python3", ["-c", isolatedPythonCode("import hf_probe_module")], {
        cwd: project,
        stdio: "ignore",
        env: { ...process.env, PYTHONSAFEPATH: "" },
      }),
    ).toThrow();
    expect(existsSync(marker)).toBe(false);

    execFileSync("python3", ["-c", isolatedPythonCode("import json")], { cwd: project });
  });
});

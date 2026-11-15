import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative, sep } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { projectCopyHint, skippedProjectCopy } from "./projectCopyHint.js";

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function program(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  const file = process.platform === "win32" ? `${name}.exe` : name;
  writeFileSync(join(dir, file), "#!/bin/sh\n", { mode: 0o755 });
}

function inProject(): { project: string; outside: string } {
  const project = tempDir("hf-copy-hint-project-");
  const outside = tempDir("hf-copy-hint-outside-");
  vi.spyOn(process, "cwd").mockReturnValue(project);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  return { project, outside };
}

describe("projectCopyHint", () => {
  it("names a project copy the PATH rule skipped, relative to the project", () => {
    const { project, outside } = inProject();
    const venv = join(project, ".venv", "bin");
    program(venv, "sam");
    const pathValue = [venv, outside].join(delimiter);

    const hint = projectCopyHint("sam", pathValue);

    expect(skippedProjectCopy("sam", pathValue)).toMatch(
      new RegExp(`^\\.\\${sep}\\.venv\\${sep}bin\\${sep}sam(\\.exe)?$`),
    );
    expect(hint).toContain("was not used");
    expect(hint).toContain("outside the current project");
    expect(hint).not.toContain(project);
  });

  it("finds a copy reached through a relative PATH entry", () => {
    const { project } = inProject();
    program(join(project, "node_modules", ".bin"), "git");

    expect(skippedProjectCopy("git", join("node_modules", ".bin"))).toMatch(
      new RegExp(`^\\.\\${sep}node_modules\\${sep}\\.bin\\${sep}git`),
    );
  });

  it("says nothing when no skipped folder holds the program", () => {
    const { project, outside } = inProject();
    program(outside, "sam");
    mkdirSync(join(project, ".venv", "bin"), { recursive: true });

    expect(projectCopyHint("sam", [join(project, ".venv", "bin"), outside].join(delimiter))).toBe(
      "",
    );
  });

  it("names a skipped copy above the working directory as a ../ path", () => {
    const { project } = inProject();
    // An npm or pnpm script run from a subfolder puts the project root's node_modules/.bin on PATH.
    writeFileSync(join(project, "package.json"), "{}");
    const sub = join(project, "video");
    mkdirSync(sub);
    vi.stubEnv("HOME", tempDir("hf-copy-hint-home-"));
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.spyOn(process, "cwd").mockReturnValue(sub);
    const bin = join(project, "node_modules", ".bin");
    program(bin, "npx");

    expect(skippedProjectCopy("npx", bin)).toMatch(
      new RegExp(`^\\.\\.\\${sep}node_modules\\${sep}\\.bin\\${sep}npx(\\.exe)?$`),
    );
    expect(projectCopyHint("npx", bin)).toContain(`..${sep}node_modules`);
  });

  it("names a relative PATH entry outside the working directory too, since the rule never trusts one", () => {
    const { project } = inProject();
    const sibling = tempDir("hf-copy-hint-sibling-");
    program(sibling, "sam");

    expect(skippedProjectCopy("sam", relative(project, sibling))).toMatch(/^\.\./);
  });
});

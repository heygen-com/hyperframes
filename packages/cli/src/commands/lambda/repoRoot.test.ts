import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repoRoot } from "./repoRoot.js";

describe("repoRoot", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-repo-root-"));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns HYPERFRAMES_REPO_ROOT when it is a hyperframes checkout", () => {
    const root = tempDir();
    mkdirSync(join(root, "packages", "aws-lambda"), { recursive: true });
    writeFileSync(join(root, "packages", "aws-lambda", "package.json"), "{}");
    vi.stubEnv("HYPERFRAMES_REPO_ROOT", root);
    expect(repoRoot()).toBe(root);
  });

  it("throws on a HYPERFRAMES_REPO_ROOT that is not a checkout instead of ignoring it", () => {
    const root = tempDir();
    vi.stubEnv("HYPERFRAMES_REPO_ROOT", root);
    expect(() => repoRoot()).toThrow(`HYPERFRAMES_REPO_ROOT=${root} is not a hyperframes checkout`);
  });
});

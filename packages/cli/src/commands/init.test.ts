import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "cli.ts");

// Spawns `bun` directly because the CLI entry is a .ts file that needs a
// TypeScript-aware runtime. vitest runs under node, so `process.execPath`
// would be node and couldn't load the entry. This repo hard-depends on bun
// (package.json scripts), so assuming it's on PATH is safe.
function runInit(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", cliEntry, "init", ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

describe("hyperframes init flag rename", () => {
  it("--example blank scaffolds a bundled project", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([target, "--example", "blank", "--non-interactive", "--skip-skills"]);
      expect(res.status).toBe(0);
      expect(existsSync(join(target, "index.html"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--template prints a rename hint and exits non-zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([target, "--template", "blank", "--non-interactive", "--skip-skills"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("--template flag was renamed to --example");
      expect(res.stderr).toContain(`--example "blank"`);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

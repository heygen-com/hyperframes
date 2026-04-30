import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  it("--example blank scaffolds a bundled project with npm scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([target, "--example", "blank", "--non-interactive", "--skip-skills"]);
      expect(res.status).toBe(0);
      expect(existsSync(join(target, "index.html"))).toBe(true);
      expect(res.stdout).toContain("npm run dev");
      expect(res.stdout).toContain("npm run check");
      expect(res.stdout).toContain("npm run render");

      const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf-8")) as {
        private?: boolean;
        type?: string;
        scripts?: Record<string, string>;
      };
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe("module");
      expect(pkg.scripts).toMatchObject({
        dev: "npx --yes hyperframes preview",
        check:
          "npx --yes hyperframes lint && npx --yes hyperframes validate && npx --yes hyperframes inspect",
        render: "npx --yes hyperframes render",
        publish: "npx --yes hyperframes publish",
      });
      expect(Object.keys(pkg.scripts ?? {}).sort()).toEqual(["check", "dev", "publish", "render"]);
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

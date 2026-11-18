import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRegistryManifest } from "./registry/remote.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the CLI test run", () => {
  it("has a home folder of its own, not the user's", () => {
    expect(realpathSync(homedir()).startsWith(realpathSync(tmpdir()) + sep)).toBe(true);
    expect(homedir()).not.toBe(userInfo().homedir);
  });

  it("caches a registry read in that home", async () => {
    const registry = `https://test.invalid/${crypto.randomUUID()}`;
    const items: unknown[] = [];
    const $schema = "https://hyperframes.heygen.com/schema/registry.json";
    const manifest = { $schema, name: "t", homepage: "https://example.com", items };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input) === `${registry}/registry.json`
          ? new Response(JSON.stringify(manifest))
          : new Response("not found", { status: 404 }),
      ),
    );

    await fetchRegistryManifest(registry);

    const slug = registry.replace(/[^a-zA-Z0-9]/g, "_");
    const cacheFiles = (home: string): string[] => {
      const dir = join(home, ".hyperframes", "cache");
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((name) => name.startsWith(`${slug}-`) && name.endsWith("__registry.json"))
        .map((name) => join(dir, name));
    };
    const leaked = cacheFiles(userInfo().homedir);
    for (const file of leaked) rmSync(file, { force: true });
    expect(cacheFiles(homedir())).toHaveLength(1);
    expect(leaked).toEqual([]);
  });

  // A cold cache write from each spawned CLI held Windows runs past the spawn timeout (scripts/test-home.mjs).
  it("spawns CLIs that write no transpiler cache into their home", () => {
    const home = mkdtempSync(join(tmpdir(), "hf-transpiler-cache-"));
    try {
      const cli = resolve(fileURLToPath(import.meta.url), "..", "cli.ts");
      const res = spawnSync("bun", ["run", cli, "--version"], {
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      expect(res.status, res.stderr).toBe(0);
      const cached = (readdirSync(home, { recursive: true }) as string[]).filter((path) =>
        path.split(/[\\/]/).includes("@t@"),
      );
      expect(cached).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

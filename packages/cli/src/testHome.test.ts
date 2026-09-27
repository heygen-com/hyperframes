import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, sep } from "node:path";
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
    const cached = (home: string) =>
      existsSync(join(home, ".hyperframes", "cache", `${slug}__registry.json`));
    expect(cached(homedir())).toBe(true);
    expect(cached(userInfo().homedir)).toBe(false);
  });
});

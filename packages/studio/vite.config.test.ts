import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config, { stableStylesCssPlugin } from "./vite.config";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as {
  publishConfig: { exports: Record<string, string> };
};
const subpaths = JSON.parse(readFileSync(resolve(__dirname, "package-subpaths.json"), "utf8")) as {
  subpaths: Record<string, { runtime: string }>;
};

// Rollup's own asset/chunk types aren't imported here; the plugin only reads
// `type` and `fileName`, so a minimal shape is enough to drive it.
function asset(fileName: string): { type: "asset"; fileName: string } {
  return { type: "asset", fileName };
}
function chunk(fileName: string): { type: "chunk"; fileName: string } {
  return { type: "chunk", fileName };
}

function callWriteBundle(dir: string, bundle: Record<string, unknown>): void {
  const writeBundle = stableStylesCssPlugin().writeBundle as (
    options: { dir: string },
    bundle: Record<string, unknown>,
  ) => void;
  writeBundle({ dir }, bundle);
}

describe("build.rollupOptions", () => {
  it("does not override assetFileNames, so every asset stays content-hashed", () => {
    // Regression for the cache bug this PR fixed: /assets/* is served with a
    // one-year immutable Cache-Control by filename convention alone
    // (packages/cli/src/server/studioServer.ts), so an unhashed name there
    // sticks to every CLI user's cache for a year.
    expect(config.build?.rollupOptions?.output).toBeUndefined();
  });
});

describe("./styles.css export path", () => {
  it("resolves outside dist/assets, so it never inherits the immutable cache header", () => {
    const publishedPath = packageJson.publishConfig.exports["./styles.css"];
    const runtimePath = subpaths.subpaths["./styles.css"]?.runtime;
    expect(publishedPath).toBe("./dist/styles.css");
    expect(runtimePath).toBe("./dist/styles.css");
    for (const path of [publishedPath, runtimePath]) {
      expect(path?.startsWith("./dist/assets/")).toBe(false);
    }
  });
});

describe("stableStylesCssPlugin", () => {
  function tmpDir(): string {
    return mkdtempSync(join(tmpdir(), "styles-css-plugin-"));
  }

  it("copies the single CSS asset, unhashed, to dist root, ignoring non-asset bundle entries", () => {
    const dir = tmpDir();
    try {
      writeFileSync(join(dir, "app-abc123.css"), "body{color:red}");
      callWriteBundle(dir, {
        "app-abc123.css": asset("app-abc123.css"),
        "app-def456.js": chunk("app-def456.js"),
        // A chunk can't really carry a `.css` name, but proving the `type`
        // guard (not just the filename suffix) does the filtering keeps the
        // count right if a future asset kind ever ends in `.css` too.
        "fake.css": chunk("fake.css"),
      });
      expect(readFileSync(join(dir, "styles.css"), "utf8")).toBe("body{color:red}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws instead of guessing when the build emits zero or several CSS assets", () => {
    const dir = tmpDir();
    try {
      expect(() => callWriteBundle(dir, { "app.js": chunk("app.js") })).toThrow(/found 0/);
      writeFileSync(join(dir, "a.css"), "a");
      writeFileSync(join(dir, "b.css"), "b");
      expect(() =>
        callWriteBundle(dir, { "a.css": asset("a.css"), "b.css": asset("b.css") }),
      ).toThrow(/found 2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

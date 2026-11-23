// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

const syncCalls = vi.hoisted(() => [] as string[]);

vi.mock("esbuild", async (importOriginal) => {
  const actual = await importOriginal<typeof import("esbuild")>();
  const blocked = (name: string) => () => {
    syncCalls.push(name);
    throw new Error(`esbuild.${name} blocks the caller's thread`);
  };
  return { ...actual, transformSync: blocked("transformSync"), buildSync: blocked("buildSync") };
});

const dir = mkdtempSync(join(tmpdir(), "hf-bundle-esbuild-async-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("strips script comments without a synchronous esbuild call", async () => {
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="root" data-width="320" data-height="180"></div>
<script src="local.js"></script>
<script>/* authored block note */ window.__timelines = window.__timelines || {}; window.__timelines.root = {};</script>
</body></html>`,
  );
  writeFileSync(join(dir, "local.js"), "window.__a = 1; // authored line note");

  const bundled = await bundleToSingleHtml(dir);

  expect(syncCalls).toEqual([]);
  expect(bundled).toContain("window.__a = 1");
  expect(bundled).not.toContain("authored line note");
  expect(bundled).not.toContain("authored block note");
});

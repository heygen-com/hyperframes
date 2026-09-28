// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-script-order-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

// The shape glass-shard-title ships: inline setup, a local src script that reads it, inline tail.
const INDEX = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.MARK_BEFORE = 1;</script>
  <script src="assets/needs-before.js"></script>
  <script>window.MARK_AFTER = 1;</script>
</body></html>`;

describe("compileForRender script order", () => {
  it("does not move an inline script past the src script that follows it", async () => {
    const dir = project({ "index.html": INDEX, "assets/needs-before.js": "void 0;" });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const before = html.indexOf("MARK_BEFORE");
    const lib = html.indexOf("assets/needs-before.js");
    const after = html.indexOf("MARK_AFTER");
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(lib);
    expect(lib).toBeLessThan(after);
  });

  it("keeps a mounted composition's local src script between the inline scripts around it", async () => {
    const dir = project({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div id="block" data-composition-id="block" data-composition-src="compositions/block/block.html" data-width="320" data-height="180"></div>
  </div>
</body></html>`,
      "compositions/block/block.html": `<!doctype html>
<html><body>
  <div data-composition-id="block" data-width="320" data-height="180"></div>
  <script>window.MARK_BEFORE = 1;</script>
  <script src="assets/needs-before.js"></script>
  <script>window.MARK_AFTER = 1;</script>
</body></html>`,
      "compositions/block/assets/needs-before.js": "void 0;",
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const before = html.indexOf("MARK_BEFORE");
    const lib = html.indexOf("compositions/block/assets/needs-before.js");
    const after = html.indexOf("MARK_AFTER");
    expect(before).toBeGreaterThan(-1);
    expect(lib).toBeGreaterThan(-1);
    expect(before).toBeLessThan(lib);
    expect(lib).toBeLessThan(after);
  });

  it("still runs a mounted composition's CDN script before its inline scripts", async () => {
    vi.stubGlobal("fetch", async () => new Response("window.CDN_LIB = 1;"));
    const dir = project({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div id="block" data-composition-id="block" data-composition-src="compositions/block/block.html" data-width="320" data-height="180"></div>
  </div>
</body></html>`,
      "compositions/block/block.html": `<!doctype html>
<html><body>
  <div data-composition-id="block" data-width="320" data-height="180"></div>
  <script>window.MARK_BEFORE = window.CDN_LIB;</script>
  <script src="https://cdn.example/lib.js"></script>
</body></html>`,
    });
    const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
      allowSystemFontCapture: false,
    });
    const lib = html.indexOf("window.CDN_LIB = 1");
    const before = html.indexOf("MARK_BEFORE");
    expect(lib).toBeGreaterThan(-1);
    expect(lib).toBeLessThan(before);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Regression coverage for the `window.__name` no-op shim that
// `frameCapture.ts` registers via `page.evaluateOnNewDocument`.
//
// Background: `@hyperframes/engine` ships raw TypeScript (see
// `packages/engine/package.json` — main and exports both point at
// `./src/index.ts`). Downstream transpilers like tsx run esbuild with
// keepNames=true, which wraps named functions in `__name(fn, "name")`
// calls. When Puppeteer serializes a `page.evaluate(callback)` argument
// via `Function.prototype.toString()`, those wrappers travel into the
// browser and throw `ReferenceError: __name is not defined` unless we
// install a no-op shim first.
//
// These source-wiring checks do not launch a browser.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAME_CAPTURE_PATH = resolve(__dirname, "frameCapture.ts");

describe("frameCapture __name polyfill", () => {
  it("registers a window.__name shim via evaluateOnNewDocument", () => {
    const source = readFileSync(FRAME_CAPTURE_PATH, "utf-8");

    expect(source).toMatch(/page\.evaluateOnNewDocument\(/);
    expect(source).toMatch(/typeof w\.__name !== "function"/);
    expect(source).toMatch(/w\.__name\s*=\s*<T>/);
  });

  it("installs the shim before any awaited browser-version checks", () => {
    const source = readFileSync(FRAME_CAPTURE_PATH, "utf-8");

    const polyfillIndex = source.indexOf("page.evaluateOnNewDocument(");
    const versionIndex = source.indexOf("await browser.version()");

    expect(polyfillIndex).toBeGreaterThan(-1);
    expect(versionIndex).toBeGreaterThan(-1);
    expect(polyfillIndex).toBeLessThan(versionIndex);
  });
});

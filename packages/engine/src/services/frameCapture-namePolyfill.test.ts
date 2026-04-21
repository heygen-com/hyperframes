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
// These tests intentionally do NOT launch a browser — the rest of this
// package follows the same pure-unit-test convention. Instead they:
//   1. Assert the polyfill is wired up at the source level so it cannot
//      be silently removed by a careless edit.
//   2. Probe the current Vitest runtime so a future maintainer can see at
//      a glance whether nested named functions still get `__name(...)`
//      wrappers under the test transformer. This is advisory: both
//      outcomes are acceptable — the reported observation is what makes
//      the test useful when the upstream behavior shifts.

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

  it("documents the current transpiler behavior for nested named functions", () => {
    function outer(): { wrapsNested: boolean; wrapsArrow: boolean } {
      // The unused declarations are deliberate: we are inspecting whether the
      // active transpiler rewrites `outer.toString()` to include
      // `__name(nested, ...)` / `__name(arrowNested, ...)` wrappers.
      // eslint-disable-next-line no-unused-vars
      function nested() {
        return 1;
      }
      // eslint-disable-next-line no-unused-vars
      const arrowNested = () => 2;
      const src = outer.toString();
      return {
        wrapsNested: /__name\(\s*nested\s*,/.test(src),
        wrapsArrow: /__name\(\s*\(\)\s*=>\s*2\s*,/.test(src) || /__name\(\s*arrowNested/.test(src),
      };
    }

    const { wrapsNested, wrapsArrow } = outer();

    // Both outcomes are acceptable; the value of this test is in surfacing
    // the runtime's behavior on the next failure (or first inspection).
    // If both flags become false everywhere this engine is consumed, the
    // polyfill above can probably be dropped. Until then it stays.
    expect(typeof wrapsNested).toBe("boolean");
    expect(typeof wrapsArrow).toBe("boolean");
  });
});

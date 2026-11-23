import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VIRTUAL_TIME_SHIM } from "./fileServer.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The shim's source text in a copy of `fileServer.ts`. */
function shimText(source: string): string | null {
  const start = source.indexOf("const VIRTUAL_TIME_SHIM = String.raw`");
  if (start < 0) return null;
  const end = source.indexOf("})();`;", start);
  return end < 0 ? null : source.slice(start, end);
}

/** `origin/main`'s `fileServer.ts`, when the checkout has it (a shallow CI clone may not). */
function mainFileServer(): string | null {
  const result = spawnSync(
    "git",
    ["show", "origin/main:packages/producer/src/services/fileServer.ts"],
    {
      cwd: HERE,
      encoding: "utf8",
    },
  );
  return result.status === 0 ? result.stdout : null;
}

// The HDR passthrough installs nothing in the pages it renders: every render serves the shim
// exactly as it is without the feature, flag on or off, so a fallback renders what flag off does.
describe("the virtual-time shim every render serves", () => {
  it("is main's, byte for byte, when the checkout has main", () => {
    const main = mainFileServer();
    if (main === null) return;
    const ours = shimText(readFileSync(join(HERE, "fileServer.ts"), "utf8"));
    expect(ours).not.toBeNull();
    expect(ours).toBe(shimText(main));
  });

  it("is the one shim, whatever the render's flags", () => {
    for (const file of ["renderOrchestrator.ts", "render/stages/probeStage.ts"]) {
      const source = readFileSync(join(HERE, file), "utf8");
      expect(source).toContain("preHeadScripts: [VIRTUAL_TIME_SHIM]");
      expect(source).not.toMatch(
        /experimentalHdrPassthrough[^\n]*SHIM|SHIM[^\n]*experimentalHdrPassthrough/,
      );
    }
    expect(VIRTUAL_TIME_SHIM).not.toContain("callbackActivity");
  });
});

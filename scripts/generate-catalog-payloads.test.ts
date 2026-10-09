import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("./generate-catalog-previews.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./generate-catalog-previews.js")>()),
  prepareProjectDir: vi.fn(),
}));
vi.mock("./catalog-payload-assets.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./catalog-payload-assets.ts")>()),
  hostItemDirectory: vi.fn(),
}));

import { prepareProjectDir } from "./generate-catalog-previews.js";
import { hostItemDirectory } from "./catalog-payload-assets.ts";
import { buildPayload, payloadRoot } from "./generate-catalog-payloads.ts";

const cleanupPaths: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-catalog-payload-"));
  cleanupPaths.push(dir);
  return dir;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const path of cleanupPaths) rmSync(path, { recursive: true, force: true });
  cleanupPaths.length = 0;
});

describe("buildPayload", () => {
  it("skips and drops a stale payload when the item's directory is over the host budget", async () => {
    const sourceDir = tmpDir();
    // Declares a local asset so `needsOwnDirectory` routes through `hostItemDirectory`.
    writeFileSync(
      join(sourceDir, "registry-item.json"),
      JSON.stringify({ files: [{ type: "hyperframes:asset" }] }),
    );
    const projectDir = tmpDir();
    writeFileSync(join(projectDir, "index.html"), "<html></html>");
    vi.mocked(prepareProjectDir).mockResolvedValue(projectDir);
    vi.mocked(hostItemDirectory).mockReturnValue({ status: "over-budget" });

    const item = {
      name: "test-over-budget-item",
      kind: "component" as const,
      sourceDir,
      entryFile: "index.html",
    };
    const outPath = join(payloadRoot, "components", `${item.name}.json`);
    cleanupPaths.push(outPath);
    mkdirSync(join(payloadRoot, "components"), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ html: "stale" }));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await buildPayload(item);

    expect(result).toBe("skipped");
    expect(existsSync(outPath)).toBe(false);
    expect(
      logSpy.mock.calls.some(
        (call) => String(call[0]).includes("host budget") && String(call[0]).includes(item.name),
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });
});

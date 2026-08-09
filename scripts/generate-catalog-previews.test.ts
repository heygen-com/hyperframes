import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const previewPath = resolve(repoRoot, "docs/images/catalog/blocks/thread-message-stack.png");

afterEach(() => rmSync(previewPath, { force: true }));

describe("catalog preview raw block boundary", () => {
  it("renders thread-message-stack through the exact Catalog Previews command", () => {
    rmSync(previewPath, { force: true });
    const result = spawnSync(
      "bunx",
      [
        "tsx",
        "scripts/generate-catalog-previews.ts",
        "--only",
        "thread-message-stack",
        "--skip-video",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).not.toContain("✗ thread-message-stack");
    expect(output).not.toContain("[Browser:ERROR]");
    expect(output).not.toContain("timelines not registered");
    expect(output).not.toContain("sub_timeline_readiness_timeout");
    expect(output).toContain("✓ thread-message-stack.png");
    expect(existsSync(previewPath)).toBe(true);
  }, 125_000);
});

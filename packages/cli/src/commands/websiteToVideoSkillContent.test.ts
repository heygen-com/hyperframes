// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const VALIDATION_GUIDE = readFileSync(
  join(REPO_ROOT, "skills", "website-to-video", "references", "step-6-validate.md"),
  "utf8",
);

describe("website-to-video validation guide", () => {
  it("does not pass cloud-only dimension flags to local render", () => {
    const localRenderExample = VALIDATION_GUIDE.match(
      /node \/<repo-root>\/packages\/cli\/dist\/cli\.js render[\s\S]*?```/,
    )?.[0];

    expect(localRenderExample).toBeDefined();
    expect(localRenderExample).not.toContain("--width");
    expect(localRenderExample).not.toContain("--height");
    expect(localRenderExample).toContain("--quality draft");
  });
});

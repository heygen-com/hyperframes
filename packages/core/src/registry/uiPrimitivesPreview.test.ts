import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs, prepareProjectDir } from "../../../../scripts/generate-catalog-previews";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Operator Black preview assembly", () => {
  it("strictly parses allowlist and workspace modes", () => {
    expect(
      parseArgs([
        "--allowlist",
        "scope.json",
        "--prepare-only",
        "prepared",
        "--only",
        "button",
        "--keep-workspace",
        "--skip-video",
      ]),
    ).toEqual({
      only: "button",
      type: null,
      skipVideo: true,
      allowlist: "scope.json",
      prepareOnly: "prepared",
      keepWorkspace: true,
    });
    expect(() => parseArgs(["--allowlist"])).toThrow("Unknown or incomplete");
    expect(() => parseArgs(["--allowlist", "a", "--type", "block"])).toThrow("component-only");
    expect(() => parseArgs(["--wat"])).toThrow("Unknown");
  });

  it("pins the declared GSAP bytes and preserves registry-relative layout", () => {
    const lock = JSON.parse(
      readFileSync(resolve(repoRoot, "registry/ui-primitives/visual-test-image.lock.json"), "utf8"),
    );
    const vendorPath = resolve(repoRoot, lock.gsap.path);
    expect(createHash("sha256").update(readFileSync(vendorPath)).digest("hex")).toBe(
      lock.gsap.sha256,
    );

    const root = mkdtempSync(resolve(tmpdir(), "operator-black-preview-test-"));
    temporaryRoots.push(root);
    const destination = resolve(root, "button");
    const projectDir = prepareProjectDir(
      {
        name: "button",
        kind: "component",
        sourceDir: resolve(repoRoot, "registry/components/button"),
        entryFile: "demo.html",
      },
      { destination, operatorBlack: true },
    );
    const index = readFileSync(resolve(projectDir, "index.html"), "utf8");
    expect(index).toContain('<base href="./registry/components/button/" />');
    expect(
      readFileSync(resolve(projectDir, "registry/ui-primitives/vendor/gsap-3.14.2.min.js"), "utf8"),
    ).toBe(readFileSync(vendorPath, "utf8"));
  });
});

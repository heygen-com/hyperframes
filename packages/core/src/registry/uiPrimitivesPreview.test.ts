import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("pins GSAP and prepares one lintable composition with registry-relative support files", () => {
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
    expect(index).not.toContain("<base ");
    expect(index).toContain(
      '<script src="registry/ui-primitives/vendor/gsap-3.14.2.min.js"></script>',
    );
    expect(existsSync(resolve(projectDir, "registry/components/button/button.html"))).toBe(true);
    expect(existsSync(resolve(projectDir, "registry/components/button/registry-item.json"))).toBe(
      true,
    );
    expect(existsSync(resolve(projectDir, "registry/components/button/demo.html"))).toBe(false);
    expect(
      readFileSync(resolve(projectDir, "registry/ui-primitives/vendor/gsap-3.14.2.min.js"), "utf8"),
    ).toBe(readFileSync(vendorPath, "utf8"));

    for (const command of ["lint", "validate"] as const) {
      expect(() =>
        execFileSync("bun", [resolve(repoRoot, "packages/cli/src/cli.ts"), command, projectDir], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "pipe",
        }),
      ).not.toThrow();
    }
  }, 15_000);

  it("continues preparing the allowlist and reports every item failure", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-preview-errors-"));
    temporaryRoots.push(root);
    mkdirSync(resolve(root, "button"));
    mkdirSync(resolve(root, "input"));

    const result = spawnSync(
      "bunx",
      [
        "tsx",
        resolve(repoRoot, "scripts/generate-catalog-previews.ts"),
        "--allowlist",
        resolve(repoRoot, "registry/ui-primitives/operator-black.scope.json"),
        "--prepare-only",
        root,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ button: Prepared workspace already exists");
    expect(result.stderr).toContain("✗ input: Prepared workspace already exists");
    expect(result.stdout).toContain("Done: 64 succeeded, 2 failed.");
    expect(existsSync(resolve(root, "tooltip/index.html"))).toBe(true);
  }, 20_000);
});

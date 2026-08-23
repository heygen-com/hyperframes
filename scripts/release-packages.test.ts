import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PUBLISHABLE_PACKAGES,
  discoverWorkspacePackages,
  validatePublishablePackages,
  type PublishablePackage,
} from "./release-packages.ts";

function writeManifest(root: string, path: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hf-release-packages-"));
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ private: true, workspaces: ["packages/*"] }, null, 2)}\n`,
  );
  for (const entry of PUBLISHABLE_PACKAGES) {
    writeManifest(root, entry.workspacePath, { name: entry.workspaceName, version: "1.0.0" });
  }
  writeManifest(root, "packages/private-tool", {
    name: "@hyperframes/private-tool",
    version: "1.0.0",
    private: true,
  });
  return root;
}

// One fixture-backed matrix documents the complete reconciliation contract.
// fallow-ignore-next-line unit-size
describe("publishable package roster", () => {
  it("covers every public workspace exactly once and excludes private workspaces", () => {
    const root = fixture();
    try {
      const discovered = discoverWorkspacePackages(root);
      assert.equal(discovered.filter((entry) => !entry.private).length, 13);
      assert.deepEqual(validatePublishablePackages(root), PUBLISHABLE_PACKAGES);
      assert.equal(
        PUBLISHABLE_PACKAGES.find((entry) => entry.workspaceName === "@hyperframes/cli")?.npmName,
        "hyperframes",
      );
      assert.equal(
        PUBLISHABLE_PACKAGES.find((entry) => entry.workspaceName === "@hyperframes/cli")
          ?.publishMode,
        "manifest-name-override",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("mutation-pins a public workspace omitted from the roster", () => {
    const root = fixture();
    try {
      const withoutSdk = PUBLISHABLE_PACKAGES.filter(
        (entry) => entry.workspaceName !== "@hyperframes/sdk",
      );
      assert.throws(
        () => validatePublishablePackages(root, withoutSdk),
        /public workspace.*@hyperframes\/sdk.*missing/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for duplicate paths, workspace names, and npm names", () => {
    const root = fixture();
    const first = PUBLISHABLE_PACKAGES[0]!;
    try {
      for (const duplicate of [
        { ...PUBLISHABLE_PACKAGES[1]!, workspacePath: first.workspacePath },
        { ...PUBLISHABLE_PACKAGES[1]!, workspaceName: first.workspaceName },
        { ...PUBLISHABLE_PACKAGES[1]!, npmName: first.npmName },
      ]) {
        const roster: PublishablePackage[] = [first, duplicate];
        assert.throws(() => validatePublishablePackages(root, roster), /duplicate/i);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing manifests, name mismatches, private entries, and invalid mappings", () => {
    const root = fixture();
    const first = PUBLISHABLE_PACKAGES[0]!;
    try {
      assert.throws(
        () =>
          validatePublishablePackages(root, [
            { ...first, workspacePath: "packages/does-not-exist" },
          ]),
        /manifest.*does not exist/i,
      );

      const manifestPath = join(root, first.workspacePath, "package.json");
      const original = readFileSync(manifestPath, "utf8");
      writeFileSync(manifestPath, original.replace(first.workspaceName, "@hyperframes/wrong"));
      assert.throws(() => validatePublishablePackages(root), /workspace name mismatch/i);
      writeFileSync(manifestPath, original);

      writeManifest(root, first.workspacePath, {
        name: first.workspaceName,
        version: "1.0.0",
        private: true,
      });
      assert.throws(() => validatePublishablePackages(root), /private.*roster/i);
      writeFileSync(manifestPath, original);

      assert.throws(
        () =>
          validatePublishablePackages(root, [{ ...first, npmName: "renamed-without-override" }]),
        /mapping.*manifest-name-override/i,
      );
      const invalidOverride: PublishablePackage = {
        ...first,
        npmName: "renamed-core",
        publishMode: "manifest-name-override",
      };
      assert.throws(
        () =>
          validatePublishablePackages(
            root,
            PUBLISHABLE_PACKAGES.map((entry) =>
              entry.workspaceName === first.workspaceName ? invalidOverride : entry,
            ),
          ),
        /only.*@hyperframes\/cli.*hyperframes/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

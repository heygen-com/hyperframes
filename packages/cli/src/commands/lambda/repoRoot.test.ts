import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repoRoot } from "./repoRoot.js";

describe("repoRoot", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-repo-root-"));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const writePackage = (dir: string, name: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  };
  // A tree that looks like a checkout: the adapter package and its SAM template.
  const plantCheckout = (root: string) => {
    writePackage(join(root, "packages", "aws-lambda"), "@hyperframes/aws-lambda");
    mkdirSync(join(root, "examples", "aws-lambda"), { recursive: true });
    writeFileSync(join(root, "examples", "aws-lambda", "template.yaml"), "Resources: {}\n");
  };

  it("returns HYPERFRAMES_REPO_ROOT when it is a hyperframes checkout", () => {
    const root = tempDir();
    writePackage(join(root, "packages", "aws-lambda"), "@hyperframes/aws-lambda");
    vi.stubEnv("HYPERFRAMES_REPO_ROOT", root);
    expect(repoRoot()).toBe(root);
  });

  it("throws on a HYPERFRAMES_REPO_ROOT that is not a checkout instead of ignoring it", () => {
    const root = tempDir();
    vi.stubEnv("HYPERFRAMES_REPO_ROOT", root);
    expect(() => repoRoot()).toThrow("HYPERFRAMES_REPO_ROOT is not a hyperframes checkout");
    expect(() => repoRoot()).not.toThrow(root);
  });

  it("throws on a HYPERFRAMES_REPO_ROOT whose packages/aws-lambda is another package", () => {
    const root = tempDir();
    writePackage(join(root, "packages", "aws-lambda"), "not-hyperframes");
    vi.stubEnv("HYPERFRAMES_REPO_ROOT", root);
    expect(() => repoRoot()).toThrow("HYPERFRAMES_REPO_ROOT is not a hyperframes checkout");
  });

  // fails without the fix: the old walk took the planted folder above the install as the checkout.
  it("ignores a checkout planted in a folder above an installed CLI", () => {
    const drive = tempDir();
    plantCheckout(drive);
    const cli = join(drive, "Users", "me", "npm", "node_modules", "@hyperframes", "cli");
    writePackage(cli, "@hyperframes/cli");
    mkdirSync(join(cli, "dist"), { recursive: true });
    expect(repoRoot(join(cli, "dist"))).toBeUndefined();
  });

  it("ignores an adapter package two folders above a CLI that is not under packages/", () => {
    const drive = tempDir();
    plantCheckout(drive);
    const cli = join(drive, "tools", "cli");
    writePackage(cli, "@hyperframes/cli");
    expect(repoRoot(join(cli, "dist"))).toBeUndefined();
  });

  it("ignores a checkout when this module is bundled into another package", () => {
    const root = tempDir();
    plantCheckout(root);
    writePackage(join(root, "packages", "app"), "someone-elses-app");
    expect(repoRoot(join(root, "packages", "app", "dist"))).toBeUndefined();
  });

  it("returns the checkout the CLI's own package sits in", () => {
    const root = tempDir();
    plantCheckout(root);
    writePackage(join(root, "packages", "cli"), "@hyperframes/cli");
    mkdirSync(join(root, "packages", "cli", "dist"), { recursive: true });
    expect(repoRoot(join(root, "packages", "cli", "dist"))).toBe(root);
  });

  it("returns undefined when the CLI's checkout has no adapter package", () => {
    const root = tempDir();
    writePackage(join(root, "packages", "cli"), "@hyperframes/cli");
    writePackage(join(root, "packages", "aws-lambda"), "something-else");
    expect(repoRoot(join(root, "packages", "cli", "src"))).toBeUndefined();
  });

  it("finds this repository from its own source", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(repoRoot()).toBe(resolve(here, "..", "..", "..", "..", ".."));
  });
});

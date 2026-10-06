import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateSamTemplate } from "./sam.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("locateSamTemplate", () => {
  it("returns the template path when it exists under repoRoot", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-lambda-sam-"));
    const samDir = join(dir, "examples", "aws-lambda");
    mkdirSync(samDir, { recursive: true });
    const templatePath = join(samDir, "template.yaml");
    writeFileSync(templatePath, "AWSTemplateFormatVersion: '2010-09-09'\n");

    expect(locateSamTemplate(dir)).toBe(templatePath);
  });

  // No --sam-template flag exists; the error must not send users to one.
  it("does not point users at the nonexistent --sam-template flag when the template is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-lambda-sam-missing-"));

    expect(() => locateSamTemplate(dir!)).toThrow(/HYPERFRAMES_REPO_ROOT/);
    expect(() => locateSamTemplate(dir!)).not.toThrow(/--sam-template/);
  });
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTerraformModuleDir } from "./terraform.js";

describe("getTerraformModuleDir", () => {
  it("resolves the adapter-owned Terraform assets through public code", () => {
    const directory = getTerraformModuleDir();
    expect(existsSync(join(directory, "main.tf"))).toBe(true);
    expect(existsSync(join(directory, "workflow.yaml"))).toBe(true);
  });
});

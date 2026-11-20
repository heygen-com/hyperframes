import { describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";

const mocks = vi.hoisted(() => ({
  adapterImportAttempted: false,
}));

vi.mock("@hyperframes/gcp-cloud-run/sdk", () => {
  mocks.adapterImportAttempted = true;
  return {};
});
vi.mock("@hyperframes/gcp-cloud-run/terraform", () => ({
  getTerraformModuleDir: vi.fn(),
}));

import cloudrunCommand from "./cloudrun.js";

async function runCloudRun(args: Record<string, unknown>): Promise<unknown> {
  return cloudrunCommand.run?.({ args, rawArgs: [], cmd: cloudrunCommand } as never);
}

describe("Cloud Run validation before optional adapter loading", () => {
  it("rejects malformed dimensions without importing the optional adapter", async () => {
    const error = await runCloudRun({
      subcommand: "render",
      target: "project",
      width: "1920.5",
      height: "1080",
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliUsageError);
    expect((error as Error).message).toContain("--width");
    expect(mocks.adapterImportAttempted).toBe(false);
  });
});

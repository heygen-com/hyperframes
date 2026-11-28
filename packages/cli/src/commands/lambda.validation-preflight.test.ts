import { describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";

const mocks = vi.hoisted(() => ({
  sdkImportAttempted: false,
}));

vi.mock("@hyperframes/aws-lambda/sdk", () => {
  mocks.sdkImportAttempted = true;
  return {};
});

import lambdaCommand from "./lambda.js";

async function runLambda(args: Record<string, unknown>): Promise<unknown> {
  return lambdaCommand.run?.({ args, rawArgs: [], cmd: lambdaCommand } as never);
}

describe("Lambda validation before optional SDK loading", () => {
  it("rejects malformed dimensions without importing the optional SDK", async () => {
    const error = await runLambda({
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
    expect(mocks.sdkImportAttempted).toBe(false);
  });
});

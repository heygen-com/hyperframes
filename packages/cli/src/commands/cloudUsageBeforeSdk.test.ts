import { afterEach, describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";

// A cold cloud SDK import took past a 15 s spawn limit on Windows runners; a usage error must not wait on one.
const loaded = vi.hoisted(() => [] as string[]);
vi.mock("@hyperframes/gcp-cloud-run/sdk", () => (loaded.push("gcp-cloud-run/sdk"), {}));
vi.mock("@hyperframes/gcp-cloud-run/terraform", () => (loaded.push("gcp-cloud-run/terraform"), {}));
vi.mock("@hyperframes/aws-lambda/sdk", () => (loaded.push("aws-lambda/sdk"), {}));

const commands = {
  cloudrun: () => import("./cloudrun.js"),
  lambda: () => import("./lambda.js"),
};

afterEach(() => {
  loaded.length = 0;
  vi.restoreAllMocks();
});

describe("a cloud command's usage error loads no cloud SDK", () => {
  it.each([
    ["cloudrun", "progress"],
    ["cloudrun", "render"],
    ["lambda", "progress"],
    ["lambda", "render"],
  ] as const)("`%s %s` with no target", async (command, subcommand) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: cmd } = await commands[command]();
    await expect(
      Promise.resolve(cmd.run?.({ args: { subcommand } } as never)),
    ).rejects.toBeInstanceOf(CliUsageError);
    expect(loaded).toEqual([]);
  });
});

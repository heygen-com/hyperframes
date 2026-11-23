import * as clack from "@clack/prompts";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import play from "./play.js";
import present from "./present.js";

const commands: Array<[string, (rawArgs: string[]) => Promise<unknown>]> = [
  ["play", (rawArgs) => runCommand(play, { rawArgs })],
  ["present", (rawArgs) => runCommand(present, { rawArgs })],
];

describe.each(commands)("%s --port", (_name, run) => {
  beforeEach(() => {
    consumeCommandResult();
    vi.spyOn(clack.log, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consumeCommandResult();
    vi.restoreAllMocks();
  });

  it.each(["0", "65536", "3003oops", "22.5"])(
    "rejects invalid value %j before resolving a project",
    async (value) => {
      await expect(run(["--port", value, "--no-open"])).rejects.toMatchObject({
        result: { exitCode: 2, kind: "usage_error" },
      });
      expect(clack.log.error).toHaveBeenCalledWith("--port must be an integer between 1 and 65535");
    },
  );
});

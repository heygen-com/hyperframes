import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listDirectProcessTermination } from "./check-cli-process-ownership.mjs";

describe("CLI process ownership checker", () => {
  it("reports direct process exit and exitCode writes", () => {
    assert.deepEqual(
      listDirectProcessTermination(
        "process.exit(1);\nprocess.exitCode = 2;\n",
        "commands/example.ts",
      ),
      [
        "commands/example.ts:1:1 uses process.exit",
        "commands/example.ts:2:1 uses process.exitCode",
      ],
    );
  });

  it("ignores typed command-result helpers and text in comments", () => {
    assert.deepEqual(
      listDirectProcessTermination(
        "// process.exit(1)\nfailCommand();\nsetCommandExitCode(1);\n",
        "commands/example.ts",
      ),
      [],
    );
  });
});

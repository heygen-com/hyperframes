import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkCliProcessOwnership,
  listDirectProcessTermination,
} from "./check-cli-process-ownership.mjs";

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

  it("lets a test fixture, spawned as its own process, exit", (t) => {
    const root = mkdtempSync(join(tmpdir(), "hf-ownership-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "packages/cli/src/utils"), { recursive: true });
    writeFileSync(join(root, "packages/cli/src/utils/a.fixture.ts"), "process.exit(0);\n");
    writeFileSync(join(root, "packages/cli/src/utils/a.ts"), "process.exit(0);\n");
    assert.deepEqual(checkCliProcessOwnership(root), [
      "packages/cli/src/utils/a.ts:1:1 uses process.exit",
    ]);
  });
});

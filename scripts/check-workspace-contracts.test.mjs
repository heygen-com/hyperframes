import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listWorkspaceContractIssues,
  REQUIRED_WORKSPACE_SCRIPTS,
} from "./check-workspace-contracts.mjs";

describe("workspace contract checker", () => {
  it("accepts workspaces with all executable lifecycle scripts", () => {
    const scripts = Object.fromEntries(REQUIRED_WORKSPACE_SCRIPTS.map((name) => [name, "echo ok"]));
    assert.deepEqual(listWorkspaceContractIssues("packages/example", { scripts }), []);
  });

  it("reports every missing or empty lifecycle script", () => {
    assert.deepEqual(
      listWorkspaceContractIssues("packages/example", { scripts: { build: " " } }),
      REQUIRED_WORKSPACE_SCRIPTS.map(
        (script) =>
          `packages/example: missing executable \`${script}\` script or ` +
          `hyperframesWorkspaceContract.${script} opt-out with a specific reason`,
      ),
    );
  });

  it("accepts an explicit opt-out only when it has a specific reason", () => {
    const pkg = {
      scripts: { build: "build", typecheck: "typecheck" },
      hyperframesWorkspaceContract: {
        test: {
          optOut: true,
          reason: "Generated fixture validated by the owning package integration suite.",
        },
      },
    };
    assert.deepEqual(listWorkspaceContractIssues("packages/example", pkg), []);

    pkg.hyperframesWorkspaceContract.test.reason = "no tests";
    assert.equal(listWorkspaceContractIssues("packages/example", pkg).length, 1);
  });
});

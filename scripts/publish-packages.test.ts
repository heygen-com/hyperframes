import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  runPublishPackages,
  sanitizePublishError,
  type PublishCommand,
} from "./publish-packages.ts";
import { type PublishablePackage } from "./release-packages.ts";

const normal: PublishablePackage = {
  workspacePath: "packages/core",
  workspaceName: "@hyperframes/core",
  npmName: "@hyperframes/core",
  publishMode: "workspace",
};
const cli: PublishablePackage = {
  workspacePath: "packages/cli",
  workspaceName: "@hyperframes/cli",
  npmName: "hyperframes",
  publishMode: "manifest-name-override",
};

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hf-publish-packages-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  for (const entry of [normal, cli]) {
    mkdirSync(join(root, entry.workspacePath), { recursive: true });
    writeFileSync(
      join(root, entry.workspacePath, "package.json"),
      `${JSON.stringify({ name: entry.workspaceName, version: "1.2.3" }, null, 2)}\n`,
    );
  }
  return root;
}

// fallow-ignore-next-line unit-size
describe("shared package publisher", () => {
  it("skips existing versions and publishes missing workspaces in roster order", async () => {
    const root = fixture();
    const calls: string[] = [];
    const command: PublishCommand = async (executable, args, cwd) => {
      calls.push(`${executable} ${args.join(" ")} @ ${cwd}`);
    };
    try {
      const result = await runPublishPackages(
        { root, version: "1.2.3", distTag: "latest", roster: [normal, cli] },
        {
          packageExists: async (name) => name === normal.npmName,
          command,
          log: () => undefined,
        },
      );
      assert.deepEqual(result, {
        published: ["hyperframes"],
        skipped: ["@hyperframes/core"],
        failed: [],
      });
      assert.deepEqual(calls, [
        `npm publish --access public --tag latest @ ${join(root, "packages/cli")}`,
      ]);
      assert.equal(
        JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).name,
        "@hyperframes/cli",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aggregates failures, continues, and restores CLI manifest bytes", async () => {
    const root = fixture();
    const cliManifest = join(root, "packages/cli/package.json");
    const original = readFileSync(cliManifest, "utf8");
    const calls: string[] = [];
    try {
      await assert.rejects(
        runPublishPackages(
          { root, version: "1.2.3", distTag: "latest", roster: [normal, cli] },
          {
            packageExists: async () => false,
            command: async (executable, args) => {
              calls.push(`${executable} ${args.join(" ")}`);
              throw new Error("publish failed");
            },
            log: () => undefined,
          },
        ),
        /@hyperframes\/core, hyperframes/,
      );
      assert.equal(calls.length, 2);
      assert.equal(readFileSync(cliManifest, "utf8"), original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves useful publish output while redacting secrets and user paths", async () => {
    const root = fixture();
    const logs: string[] = [];
    const error = Object.assign(new Error("npm publish failed for /home/private-user/project"), {
      stdout: "uploaded package metadata\n",
      stderr:
        "npm ERR! code E403\n//registry.npmjs.org/:_authToken=super-secret\naccess_token=also-secret\n",
    });
    try {
      assert.match(sanitizePublishError(error), /E403/);
      assert.doesNotMatch(sanitizePublishError(error), /super-secret|also-secret|private-user/);
      await assert.rejects(
        runPublishPackages(
          { root, version: "1.2.3", distTag: "latest", roster: [normal, cli] },
          {
            packageExists: async () => false,
            command: async () => {
              throw error;
            },
            log: (message) => logs.push(message),
          },
        ),
        /E403/,
      );
      assert.match(logs.join("\n"), /uploaded package metadata|E403/);
      assert.doesNotMatch(logs.join("\n"), /super-secret|also-secret|private-user/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails reconciliation before any npm boundary when a public workspace is omitted", async () => {
    const root = fixture();
    let calls = 0;
    try {
      await assert.rejects(
        runPublishPackages(
          { root, version: "1.2.3", distTag: "latest", roster: [normal] },
          {
            packageExists: async () => false,
            command: async () => {
              calls += 1;
            },
            log: () => undefined,
          },
        ),
        /public workspace.*@hyperframes\/cli.*missing/i,
      );
      assert.equal(calls, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

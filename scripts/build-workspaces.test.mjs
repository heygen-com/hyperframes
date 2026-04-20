import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBuildBatches, readBuildWorkspaces } from "./build-workspaces-lib.mjs";

test("creates deterministic topological build batches from workspace deps", () => {
  const batches = createBuildBatches([
    {
      name: "@hyperframes/cli",
      deps: [
        "@hyperframes/core",
        "@hyperframes/engine",
        "@hyperframes/producer",
        "@hyperframes/studio",
      ],
    },
    { name: "@hyperframes/core", deps: [] },
    { name: "@hyperframes/engine", deps: ["@hyperframes/core"] },
    { name: "@hyperframes/player", deps: [] },
    { name: "@hyperframes/producer", deps: ["@hyperframes/core", "@hyperframes/engine"] },
    { name: "@hyperframes/shader-transitions", deps: [] },
    {
      name: "@hyperframes/studio",
      deps: ["@hyperframes/core", "@hyperframes/player", "@hyperframes/producer"],
    },
  ]);

  assert.deepEqual(batches, [
    ["@hyperframes/core", "@hyperframes/player", "@hyperframes/shader-transitions"],
    ["@hyperframes/engine"],
    ["@hyperframes/producer"],
    ["@hyperframes/studio"],
    ["@hyperframes/cli"],
  ]);
});

test("ignores dependencies that are not part of the workspace build set", () => {
  const batches = createBuildBatches([
    { name: "@hyperframes/core", deps: [] },
    { name: "@hyperframes/engine", deps: ["@hyperframes/core", "puppeteer"] },
  ]);

  assert.deepEqual(batches, [["@hyperframes/core"], ["@hyperframes/engine"]]);
});

test("throws a helpful error when the workspace build graph contains a cycle", () => {
  assert.throws(
    () =>
      createBuildBatches([
        { name: "@hyperframes/a", deps: ["@hyperframes/b"] },
        { name: "@hyperframes/b", deps: ["@hyperframes/a"] },
      ]),
    /cycle/i,
  );
});

test("ignores workspace directories that do not contain a package.json", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "hyperframes-build-graph-"));

  try {
    mkdirSync(join(rootDir, "packages"));
    mkdirSync(join(rootDir, "packages", ".debug"));
    mkdirSync(join(rootDir, "packages", "core"));

    writeFileSync(join(rootDir, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFileSync(
      join(rootDir, "packages", "core", "package.json"),
      JSON.stringify({
        name: "@hyperframes/core",
        scripts: { build: "tsc" },
      }),
    );

    const workspaces = readBuildWorkspaces(rootDir);
    assert.deepEqual(workspaces, [
      {
        name: "@hyperframes/core",
        dir: join(rootDir, "packages", "core"),
        deps: [],
      },
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

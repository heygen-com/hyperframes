import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkDockerfileWorkspaces,
  findRuntimeWorkspaceDirectories,
  listDockerfileWorkspaceIssues,
  readWorkspacePackages,
} from "./check-dockerfile-workspaces.mjs";

const workspaces = [
  workspace("core", "@hyperframes/core", {
    "@hyperframes/lint": "workspace:*",
    "@hyperframes/studio-server": "workspace:*",
  }),
  workspace("engine", "@hyperframes/engine", {
    "@hyperframes/core": "workspace:*",
    "@hyperframes/parsers": "workspace:*",
  }),
  workspace("gcp-cloud-run", "@hyperframes/gcp-cloud-run", {
    "@hyperframes/producer": "workspace:*",
  }),
  workspace("lint", "@hyperframes/lint", { "@hyperframes/parsers": "workspace:*" }),
  workspace("parsers", "@hyperframes/parsers"),
  workspace("producer", "@hyperframes/producer", {
    "@hyperframes/core": "workspace:*",
    "@hyperframes/engine": "workspace:*",
  }),
  workspace("sdk", "@hyperframes/sdk"),
  workspace("studio-server", "@hyperframes/studio-server", {
    "@hyperframes/core": "workspace:*",
  }),
];
const runtimeDirectories = [
  "core",
  "engine",
  "gcp-cloud-run",
  "lint",
  "parsers",
  "producer",
  "studio-server",
];
const buildDirectories = [
  "core",
  "engine",
  "lint",
  "parsers",
  "studio-server",
  "producer",
  "gcp-cloud-run",
];

function workspace(directory, name, dependencies = {}) {
  return { directory, manifest: { name, scripts: { build: "build" }, dependencies } };
}

function dockerfile({
  manifests = workspaces.map((candidate) => candidate.directory),
  sources = runtimeDirectories,
  builds = buildDirectories,
} = {}) {
  return [
    ...manifests.map(
      (directory) => `COPY packages/${directory}/package.json packages/${directory}/package.json`,
    ),
    ...sources.map((directory) => `COPY packages/${directory}/ packages/${directory}/`),
    ...builds.map((directory) => `RUN bun run --cwd packages/${directory} build`),
  ].join("\n");
}

describe("GCP Cloud Run Dockerfile workspace checker", () => {
  it("accepts the repository Dockerfile", () => {
    assert.equal(checkDockerfileWorkspaces(), readWorkspacePackages().length);
  });

  it("derives the runtime closure without looping on workspace cycles", () => {
    assert.deepEqual([...findRuntimeWorkspaceDirectories(workspaces)].sort(), runtimeDirectories);
  });

  it("reports a missing workspace manifest", () => {
    const manifests = workspaces
      .map((candidate) => candidate.directory)
      .filter((directory) => directory !== "sdk");
    assert.deepEqual(listDockerfileWorkspaceIssues(dockerfile({ manifests }), workspaces), [
      "missing workspace manifests: sdk",
    ]);

    const misdirected = dockerfile().replace(
      "COPY packages/sdk/package.json packages/sdk/package.json",
      "COPY packages/sdk/package.json packages/wrong/package.json",
    );
    assert.deepEqual(listDockerfileWorkspaceIssues(misdirected, workspaces), [
      "missing workspace manifests: sdk",
    ]);
  });

  it("reports a missing runtime source copy", () => {
    const sources = runtimeDirectories.filter((directory) => directory !== "parsers");
    assert.deepEqual(listDockerfileWorkspaceIssues(dockerfile({ sources }), workspaces), [
      "missing runtime workspace sources: parsers",
    ]);

    const misdirected = dockerfile().replace(
      "COPY packages/parsers/ packages/parsers/",
      "COPY packages/parsers/ packages/wrong/",
    );
    assert.deepEqual(listDockerfileWorkspaceIssues(misdirected, workspaces), [
      "missing runtime workspace sources: parsers",
    ]);
  });

  it("requires every buildable runtime prerequisite before producer", () => {
    const builds = buildDirectories.filter((directory) => directory !== "lint");
    assert.deepEqual(listDockerfileWorkspaceIssues(dockerfile({ builds }), workspaces), [
      "runtime workspaces must run their full build before producer: lint",
    ]);

    const lateBuilds = buildDirectories.filter((directory) => directory !== "lint");
    lateBuilds.splice(lateBuilds.indexOf("producer") + 1, 0, "lint");
    assert.deepEqual(
      listDockerfileWorkspaceIssues(dockerfile({ builds: lateBuilds }), workspaces),
      ["runtime workspaces must run their full build before producer: lint"],
    );
  });

  it("does not mistake a build subcommand for a full workspace build", () => {
    const input = dockerfile()
      .replace(
        "RUN bun run --cwd packages/core build",
        "RUN bun run --cwd packages/core build:hyperframes-runtime:modular",
      )
      .concat("\n# bun run --cwd packages/core build");
    assert.deepEqual(listDockerfileWorkspaceIssues(input, workspaces), [
      "runtime workspaces must run their full build before producer: core",
    ]);
  });

  it("requires producer to be built before the adapter", () => {
    const builds = buildDirectories.filter((directory) => directory !== "producer");
    builds.push("producer");
    assert.deepEqual(listDockerfileWorkspaceIssues(dockerfile({ builds }), workspaces), [
      "producer must be built before gcp-cloud-run",
    ]);
  });
});

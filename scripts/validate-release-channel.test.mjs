import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expectedDistTag,
  getPrereleaseId,
  normalizeRemoteBranches,
  validateReleaseChannel,
} from "./validate-release-channel.mjs";

describe("release channel validation", () => {
  it("derives dist-tags from stable and prerelease versions", () => {
    assert.equal(getPrereleaseId("0.4.24"), null);
    assert.equal(getPrereleaseId("0.4.24-alpha.1"), "alpha");
    assert.equal(expectedDistTag("0.4.24"), "latest");
    assert.equal(expectedDistTag("0.4.24-alpha.1"), "alpha");
  });

  it("allows a stable release from a reviewed release PR", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24",
      distTag: "latest",
      eventName: "pull_request",
      prHeadRef: "release/v0.4.24",
      remoteBranches: [],
    });

    assert.deepEqual(errors, []);
  });

  it("blocks stable tag pushes even when reachable from main", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24",
      distTag: "latest",
      eventName: "push",
      prHeadRef: "",
      remoteBranches: ["origin/main", "origin/next"],
    });

    assert.equal(errors.length, 1);
    assert.match(errors[0], /Stable tag publishing is disabled/);
  });

  it("blocks stable tags that only live on an unmerged release branch", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24",
      distTag: "latest",
      eventName: "push",
      prHeadRef: "",
      remoteBranches: ["origin/release/v0.4.24"],
    });

    assert.equal(errors.length, 1);
    assert.match(errors[0], /Stable tag publishing is disabled/);
  });

  it("allows alpha tags reachable from next", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24-alpha.1",
      distTag: "alpha",
      eventName: "push",
      prHeadRef: "",
      remoteBranches: ["origin/next"],
    });

    assert.deepEqual(errors, []);
  });

  it("blocks prerelease tags from stable branches", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24-alpha.1",
      distTag: "alpha",
      eventName: "push",
      prHeadRef: "",
      remoteBranches: ["origin/main"],
    });

    assert.equal(errors.length, 1);
    assert.match(errors[0], /alpha releases must be reachable from origin\/next/);
  });

  it("blocks dist-tag mismatches", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24-alpha.1",
      distTag: "latest",
      eventName: "push",
      prHeadRef: "",
      remoteBranches: ["origin/next"],
    });

    assert.equal(errors.length, 1);
    assert.match(errors[0], /must publish with npm dist-tag "alpha"/);
  });

  it("keeps merged release PRs stable-only", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24-alpha.1",
      distTag: "alpha",
      eventName: "pull_request",
      prHeadRef: "release/v0.4.24-alpha.1",
      remoteBranches: [],
    });

    assert.equal(errors.length, 2);
    assert.match(errors.join("\n"), /release\/vX\.Y\.Z/);
    assert.match(errors.join("\n"), /stable releases only/);
  });

  it("rejects manual publish events", () => {
    const errors = validateReleaseChannel({
      version: "0.4.24",
      distTag: "latest",
      eventName: "workflow_dispatch",
      prHeadRef: "",
      remoteBranches: ["origin/main"],
    });

    assert.deepEqual(errors, ['Unsupported publish event "workflow_dispatch".']);
  });

  it("normalizes git branch output", () => {
    assert.deepEqual(
      normalizeRemoteBranches("  origin/HEAD -> origin/main\n* origin/main\n  origin/next\n"),
      ["origin/main", "origin/next"],
    );
  });
});

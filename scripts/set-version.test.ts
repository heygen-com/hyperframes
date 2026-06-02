import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changelogArtifacts,
  gitStatusPath,
  isPrerelease,
  parseReleaseOptions,
  releaseRequiresChangelog,
} from "./set-version.ts";

describe("set-version release options", () => {
  it("parses stable release flags", () => {
    assert.deepEqual(parseReleaseOptions(["1.2.3", "--no-tag", "--skip-changelog-check"]), {
      version: "1.2.3",
      skipTag: true,
      skipChangelogCheck: true,
    });
  });

  it("requires reviewed changelog artifacts for stable tagged releases", () => {
    assert.equal(
      releaseRequiresChangelog({
        version: "1.2.3",
        skipTag: false,
        skipChangelogCheck: false,
      }),
      true,
    );
  });

  it("does not require changelog artifacts for prereleases, no-tag bumps, or emergency skips", () => {
    assert.equal(isPrerelease("1.2.3-alpha.1"), true);
    assert.equal(
      releaseRequiresChangelog({
        version: "1.2.3-alpha.1",
        skipTag: false,
        skipChangelogCheck: false,
      }),
      false,
    );
    assert.equal(
      releaseRequiresChangelog({
        version: "1.2.3",
        skipTag: true,
        skipChangelogCheck: false,
      }),
      false,
    );
    assert.equal(
      releaseRequiresChangelog({
        version: "1.2.3",
        skipTag: false,
        skipChangelogCheck: true,
      }),
      false,
    );
  });

  it("tracks both GitHub release and docs changelog artifacts", () => {
    assert.deepEqual(changelogArtifacts("1.2.3"), [
      "releases/v1.2.3.md",
      "docs/changelog.mdx#HyperFrames v1.2.3",
    ]);
  });
});

describe("git status parsing", () => {
  it("extracts unquoted porcelain paths", () => {
    assert.equal(gitStatusPath(" M docs/changelog.mdx"), "docs/changelog.mdx");
  });

  it("extracts quoted porcelain paths", () => {
    assert.equal(gitStatusPath('?? "releases/v1.2.3.md"'), "releases/v1.2.3.md");
  });
});

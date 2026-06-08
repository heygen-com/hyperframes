import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changelogArtifacts,
  compareSemver,
  findUnexpectedChanges,
  isPrerelease,
  parseReleaseOptions,
  releaseAllowedPaths,
  releaseRequiresChangelog,
  splitNulList,
} from "./set-version.ts";

describe("set-version release options", () => {
  it("parses stable release flags", () => {
    assert.deepEqual(parseReleaseOptions(["1.2.3", "--no-tag", "--skip-changelog-check"]), {
      version: "1.2.3",
      skipTag: true,
      skipChangelogCheck: true,
      skipMonotonicityCheck: false,
    });
  });

  it("parses --skip-monotonicity-check flag", () => {
    assert.deepEqual(parseReleaseOptions(["0.6.82", "--skip-monotonicity-check"]), {
      version: "0.6.82",
      skipTag: false,
      skipChangelogCheck: false,
      skipMonotonicityCheck: true,
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

describe("semver comparison", () => {
  it("returns negative when a < b", () => {
    assert.ok(compareSemver("0.6.82", "1.0.3") < 0);
  });

  it("returns positive when a > b", () => {
    assert.ok(compareSemver("1.0.4", "0.6.82") > 0);
  });

  it("returns zero for equal versions", () => {
    assert.equal(compareSemver("0.6.82", "0.6.82"), 0);
  });

  it("compares major version first", () => {
    assert.ok(compareSemver("2.0.0", "1.99.99") > 0);
  });

  it("compares minor when major is equal", () => {
    assert.ok(compareSemver("0.7.0", "0.6.99") > 0);
  });

  it("compares patch when major and minor are equal", () => {
    assert.ok(compareSemver("0.6.83", "0.6.82") > 0);
  });
});

describe("changed-path guard", () => {
  it("splits NUL-separated git output and drops the empty trailing entry", () => {
    assert.deepEqual(splitNulList("packages/core/package.json\0releases/v1.2.3.md\0"), [
      "packages/core/package.json",
      "releases/v1.2.3.md",
    ]);
    assert.deepEqual(splitNulList(""), []);
  });

  it("accepts a release whose changes are all allowed paths", () => {
    const allowed = releaseAllowedPaths("1.2.3");
    assert.deepEqual(
      findUnexpectedChanges(
        ["packages/core/package.json", ".claude-plugin/plugin.json", "releases/v1.2.3.md"],
        allowed,
      ),
      [],
    );
  });

  it("flags changes outside the allowed release paths", () => {
    const allowed = releaseAllowedPaths("1.2.3");
    assert.deepEqual(
      findUnexpectedChanges(["packages/core/package.json", "packages/core/src/index.ts"], allowed),
      ["packages/core/src/index.ts"],
    );
  });
});

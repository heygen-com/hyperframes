import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDraftCommandArgs,
  buildSetVersionCommandArgs,
  parsePrepareOptions,
  resolveStableReleaseAction,
} from "./release-prepare.ts";
import {
  CHANGELOG_REVIEW_TODO,
  docsChangelogEntryHasGeneratedTodo,
  hasGeneratedChangelogTodo,
} from "./set-version.ts";

describe("release prepare arguments", () => {
  it("parses changelog draft and set-version options", () => {
    assert.deepEqual(
      parsePrepareOptions([
        "v1.2.3",
        "--from",
        "v1.2.2",
        "--to=HEAD",
        "--date",
        "2026-06-02",
        "--force",
        "--no-tag",
        "--skip-changelog-check",
      ]),
      {
        version: "1.2.3",
        from: "v1.2.2",
        to: "HEAD",
        date: "2026-06-02",
        force: true,
        skipTag: true,
        skipChangelogCheck: true,
      },
    );
  });
});

describe("release prepare actions", () => {
  it("drafts when reviewed changelog artifacts are missing", () => {
    assert.equal(
      resolveStableReleaseAction({
        missingArtifacts: ["releases/v1.2.3.md"],
        unreviewedArtifacts: [],
      }),
      "draft",
    );
  });

  it("blocks on review when generated TODOs are still present", () => {
    assert.equal(
      resolveStableReleaseAction({
        missingArtifacts: [],
        unreviewedArtifacts: ["docs/changelog.mdx#HyperFrames v1.2.3"],
      }),
      "review",
    );
  });

  it("delegates to set-version after artifacts are reviewed", () => {
    assert.equal(
      resolveStableReleaseAction({
        missingArtifacts: [],
        unreviewedArtifacts: [],
      }),
      "set-version",
    );
  });
});

describe("release prepare command builders", () => {
  it("passes only changelog options to changelog:draft", () => {
    assert.deepEqual(
      buildDraftCommandArgs({
        version: "1.2.3",
        from: "v1.2.2",
        to: "HEAD",
        date: "2026-06-02",
        force: true,
        skipTag: true,
        skipChangelogCheck: true,
      }),
      [
        "run",
        "changelog:draft",
        "1.2.3",
        "--write",
        "--force",
        "--from",
        "v1.2.2",
        "--to",
        "HEAD",
        "--date",
        "2026-06-02",
      ],
    );
  });

  it("passes only release options to set-version", () => {
    assert.deepEqual(
      buildSetVersionCommandArgs({
        version: "1.2.3",
        from: "v1.2.2",
        to: "HEAD",
        date: "2026-06-02",
        force: true,
        skipTag: true,
        skipChangelogCheck: true,
      }),
      ["run", "set-version", "1.2.3", "--no-tag", "--skip-changelog-check"],
    );
  });
});

describe("reviewed changelog detection", () => {
  it("detects the generated TODO marker", () => {
    assert.equal(hasGeneratedChangelogTodo(CHANGELOG_REVIEW_TODO), true);
    assert.equal(hasGeneratedChangelogTodo("Polished user-facing summary."), false);
  });

  it("checks only the matching docs changelog entry", () => {
    const docs = `
<Update label="HyperFrames v1.2.4">
Reviewed summary.
</Update>

<Update label="HyperFrames v1.2.3">
${CHANGELOG_REVIEW_TODO}
</Update>
`;

    assert.equal(docsChangelogEntryHasGeneratedTodo(docs, "HyperFrames v1.2.3"), true);
    assert.equal(docsChangelogEntryHasGeneratedTodo(docs, "HyperFrames v1.2.4"), false);
  });
});

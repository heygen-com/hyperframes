import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeForMdx,
  findSkippedReleaseTags,
  parseArgs,
  parseCommit,
  renderCommitBullet,
  renderMdxCommitBullet,
  renderTags,
  shouldSkipCommit,
  type RawCommit,
} from "./draft-changelog.ts";

const REPO_URL = "https://github.com/heygen-com/hyperframes";

function commit(subject: string): RawCommit {
  return {
    sha: "1234567890abcdef1234567890abcdef12345678",
    shortSha: "1234567",
    author: "Test Author",
    subject,
  };
}

describe("draft changelog arguments", () => {
  it("parses positional, value, inline, and boolean options", () => {
    assert.deepEqual(
      parseArgs([
        "v1.2.3",
        "--from",
        "v1.2.2",
        "--to=HEAD",
        "--date",
        "2026-06-02",
        "--write",
        "--force",
      ]),
      {
        version: "1.2.3",
        from: "v1.2.2",
        to: "HEAD",
        date: "2026-06-02",
        write: true,
        force: true,
      },
    );
  });
});

describe("draft changelog commit parsing", () => {
  it("categorizes conventional commit types", () => {
    assert.equal(parseCommit(commit("feat: add timeline markers")).category, "Features");
    assert.equal(parseCommit(commit("fix: repair audio sync")).category, "Fixes");
    assert.equal(parseCommit(commit("perf: reduce render startup")).category, "Performance");
    assert.equal(parseCommit(commit("docs: update quickstart")).category, "Docs & Examples");
    assert.equal(parseCommit(commit("test: cover frame capture")).category, "Internal");
    assert.equal(parseCommit(commit("move the preview panel")).category, "Other Changes");
  });

  it("detects catalog changes from scope or summary", () => {
    assert.equal(parseCommit(commit("feat(catalog): add kinetic title")).category, "Catalog");
    assert.equal(parseCommit(commit("fix: repair registry preview metadata")).category, "Catalog");
  });

  it("lets breaking changes override the normal category", () => {
    const parsed = parseCommit(commit("fix(cli)!: remove legacy render flag"));

    assert.equal(parsed.breaking, true);
    assert.equal(parsed.category, "Breaking Changes");
  });

  it("skips release, bump, and explicit skip commits", () => {
    assert.equal(shouldSkipCommit(commit("chore: release v1.2.3")), true);
    assert.equal(shouldSkipCommit(commit("chore: bump version to v1.2.3")), true);
    assert.equal(shouldSkipCommit(commit("fix: internal cleanup [skip changelog]")), true);
    assert.equal(shouldSkipCommit(commit("fix: real user-facing bug")), false);
  });
});

describe("draft changelog rendering", () => {
  it("renders commit bullets with scope and pull request links", () => {
    const parsed = parseCommit(commit("feat(cli): add render hints (#42)"));

    assert.equal(
      renderCommitBullet(parsed),
      `- **CLI:** Add render hints ([1234567](${REPO_URL}/commit/1234567890abcdef1234567890abcdef12345678), [#42](${REPO_URL}/pull/42)).`,
    );
  });

  it("renders commit bullets without scope or pull request links", () => {
    const parsed = parseCommit(commit("fix: repair playback"));

    assert.equal(
      renderCommitBullet(parsed),
      `- Repair playback ([1234567](${REPO_URL}/commit/1234567890abcdef1234567890abcdef12345678)).`,
    );
  });

  it("escapes MDX-sensitive characters only in docs bullets", () => {
    const parsed = parseCommit(commit("feat(docs): support <Update> blocks with {tags} (#7)"));

    assert.equal(
      escapeForMdx("\\<Update>{tags}</Update>"),
      "\\\\\\<Update\\>\\{tags\\}\\</Update\\>",
    );
    assert.ok(
      renderMdxCommitBullet(parsed).includes("Support \\<Update\\> blocks with \\{tags\\}"),
    );
    assert.ok(renderCommitBullet(parsed).includes("Support <Update> blocks with {tags}"));
  });
});

describe("skipped release tags", () => {
  const TAGS = ["0.8.49", "0.8.50", "0.8.51"];

  it("names a tag the baseline skipped", () => {
    // The v0.8.52 cut: a stale local v0.8.51 was unreachable, so describe fell
    // back to v0.8.50 and the draft re-listed ~100 already-released commits.
    assert.deepEqual(findSkippedReleaseTags(TAGS, "v0.8.50", "0.8.52"), ["0.8.51"]);
  });

  it("passes when the baseline is the immediately preceding release", () => {
    assert.deepEqual(findSkippedReleaseTags(TAGS, "v0.8.51", "0.8.52"), []);
  });

  it("excludes the baseline and the release being drafted", () => {
    // Both ends are exclusive: v0.8.50 is the baseline and v0.8.51 is the
    // release, so neither counts as skipped.
    assert.deepEqual(findSkippedReleaseTags(TAGS, "v0.8.50", "0.8.51"), []);
  });

  it("reports every skipped release in ascending order", () => {
    assert.deepEqual(findSkippedReleaseTags(TAGS, "v0.8.48", "0.8.52"), [
      "0.8.49",
      "0.8.50",
      "0.8.51",
    ]);
  });

  it("compares numerically, not lexically", () => {
    // "0.8.9" > "0.8.10" as strings; a string sort would miss this entirely.
    assert.deepEqual(findSkippedReleaseTags(["0.8.9", "0.8.10"], "v0.8.8", "0.8.11"), [
      "0.8.9",
      "0.8.10",
    ]);
  });

  it("accepts a baseline with or without the v prefix", () => {
    assert.deepEqual(findSkippedReleaseTags(TAGS, "0.8.50", "0.8.52"), ["0.8.51"]);
  });
});

describe("release tags", () => {
  it("names Release once, even when a commit is scoped to the release itself", () => {
    const commits = [
      "fix(studio-server): inject page tags (#1)",
      "docs(release): list the changes v1.2.3 also shipped (#2)",
      "fix(core): wait for a loading video (#3)",
      "fix(studio): open at Fit (#4)",
    ].map((subject) => parseCommit(commit(subject)));

    assert.deepEqual(renderTags(commits), ["Release", "Studio Server", "Core", "Studio"]);
  });
});

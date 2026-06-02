import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeForMdx,
  parseArgs,
  parseCommit,
  renderCommitBullet,
  renderMdxCommitBullet,
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
      `- **CLI:** Add render hints ([1234567](${REPO_URL}/commit/1234567890abcdef1234567890abcdef12345678), [#42](${REPO_URL}/pull/42))`,
    );
  });

  it("renders commit bullets without scope or pull request links", () => {
    const parsed = parseCommit(commit("fix: repair playback"));

    assert.equal(
      renderCommitBullet(parsed),
      `- Repair playback ([1234567](${REPO_URL}/commit/1234567890abcdef1234567890abcdef12345678))`,
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

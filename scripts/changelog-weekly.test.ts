import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWeeklyDraft, parseWeeklyOptions, weeklyPacketPaths } from "./changelog-weekly.ts";
import { parseCommit, type RawCommit } from "./draft-changelog.ts";

function commit(subject: string) {
  const raw: RawCommit = {
    sha: "1234567890abcdef1234567890abcdef12345678",
    shortSha: "1234567",
    author: "Test Author",
    subject,
  };

  return {
    ...parseCommit(raw),
    date: "2026-06-03",
  };
}

describe("weekly changelog arguments", () => {
  it("parses date range and write flags", () => {
    assert.deepEqual(
      parseWeeklyOptions(["--from", "2026-06-01", "--to=2026-06-07", "--write", "--force"]),
      {
        from: "2026-06-01",
        to: "2026-06-07",
        write: true,
        force: true,
      },
    );
  });
});

describe("weekly changelog rendering", () => {
  it("creates docs, source, Discord, and X drafts", () => {
    const draft = createWeeklyDraft(
      {
        from: "2026-06-01",
        to: "2026-06-07",
        write: false,
        force: false,
      },
      [commit("feat(cli): add render hints (#42)"), commit("fix: repair playback")],
    );

    assert.match(draft.docsUpdate, /label="Week of June 1, 2026"/);
    assert.match(draft.weeklyNotes, /HyperFrames weekly digest - June 1, 2026 - June 7, 2026/);
    assert.match(draft.discordDraft, /This week's highlights:/);
    assert.match(draft.xDraft, /Full update: TODO add docs link/);
  });

  it("keeps internal and editorial-only changes out of top highlights", () => {
    const draft = createWeeklyDraft(
      {
        from: "2026-06-01",
        to: "2026-06-07",
        write: false,
        force: false,
      },
      [
        commit("feat(docs): add changelog release workflow (#41)"),
        commit("fix(cli): validate cloud render input (#42)"),
        commit("chore: update generated baselines (#43)"),
      ],
    );

    assert.match(draft.discordDraft, /CLI: Validate cloud render input/);
    assert.doesNotMatch(draft.discordDraft, /Docs: Add changelog release workflow/);
    assert.doesNotMatch(draft.docsUpdate, /Update generated baselines/);
  });

  it("uses predictable packet paths from the week ending date", () => {
    assert.deepEqual(weeklyPacketPaths("2026-06-07"), {
      weeklyNotes: "updates/weekly/2026-06-07.md",
      discordDraft: "updates/social/2026-06-07.discord.md",
      xDraft: "updates/social/2026-06-07.x.md",
    });
  });
});

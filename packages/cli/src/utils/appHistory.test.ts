import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_HISTORY_FILE,
  appHistoryNotice,
  filesChangedSince,
  markSeen,
  readAppTurns,
  seenAt,
  unseenTurns,
} from "./appHistory.js";

function project(lines: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-app-history-"));
  mkdirSync(join(dir, ".hyperframes"));
  writeFileSync(join(dir, APP_HISTORY_FILE), lines.join("\n"));
  return dir;
}

const turn = (at: string, asked: string) =>
  JSON.stringify({ at, engine: "claude", asked, did: "Done.", files: ["index.html"] });

describe("app history", () => {
  it("reads the turns, skipping lines that are not one", () => {
    const dir = project([
      turn("2026-10-06T10:00:00Z", "bigger title"),
      "not json",
      '{"at":"never"}',
      "",
    ]);
    expect(readAppTurns(dir)).toEqual([
      {
        at: "2026-10-06T10:00:00Z",
        engine: "claude",
        asked: "bigger title",
        did: "Done.",
        files: ["index.html"],
      },
    ]);
  });

  it("shows only the turns after the hand-off or the last catch-up", () => {
    const dir = project([turn("2026-10-06T10:00:00Z", "old"), turn("2026-10-06T11:00:00Z", "new")]);
    expect(unseenTurns(dir).map((t) => t.asked)).toEqual(["old", "new"]);
    markSeen(dir, new Date("2026-10-06T10:30:00Z"));
    expect(seenAt(dir)).toBe(Date.parse("2026-10-06T10:30:00Z"));
    expect(unseenTurns(dir).map((t) => t.asked)).toEqual(["new"]);
  });

  it("never follows a link in place of the history", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-app-history-"));
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(join(dir, "elsewhere.jsonl"), turn("2026-10-06T10:00:00Z", "planted"));
    symlinkSync(join(dir, "elsewhere.jsonl"), join(dir, APP_HISTORY_FILE));
    expect(readAppTurns(dir)).toEqual([]);
  });

  it("lists the video's files changed since then, not hidden folders or outputs", () => {
    const dir = project();
    mkdirSync(join(dir, "compositions"));
    mkdirSync(join(dir, "renders"));
    for (const file of [
      "index.html",
      "compositions/a.html",
      "renders/out.mp4",
      ".hyperframes/x.json",
    ])
      writeFileSync(join(dir, file), "x");
    utimesSync(join(dir, "index.html"), new Date(1000), new Date(1000));
    expect(filesChangedSince(dir, 5000)).toEqual(["compositions/a.html"]);
  });

  it("names unseen turns at the end of a command run in the project or on it", () => {
    const dir = project([turn("2026-01-01T10:00:00Z", "a"), turn("2026-01-01T11:00:00Z", "b")]);
    expect(appHistoryNotice(dir, [])).toContain("2 chat turns");
    expect(appHistoryNotice(join(dir, ".."), [dir])).toContain(`catch-up ${dir.split("/").pop()}`);
    markSeen(dir);
    expect(appHistoryNotice(dir, [])).toBeNull();
  });
});

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addCatchUpNote,
  APP_HISTORY,
  appHistoryNotice,
  CATCH_UP_NOTE,
  filesChangedSince,
  markSeen,
  readAppTurns,
  readSeen,
  unseenTurns,
} from "./appHistory.js";
import { readRecord, writeRecord } from "./projectRecords.js";

const history = (dir: string) => join(dir, ".hyperframes", APP_HISTORY);

function project(lines: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-app-history-"));
  mkdirSync(join(dir, ".hyperframes"));
  writeFileSync(history(dir), lines.join("\n"));
  return dir;
}

const turn = (at: string, asked: string) =>
  JSON.stringify({ at, engine: "claude", asked, did: "Done.", files: ["index.html"] });

const handedOverAt = (dir: string, at: string) =>
  markSeen(dir, { at: Date.parse(at), checked: Date.parse(at) });

describe("app history", () => {
  it("reads the turns, skipping lines that are not one", () => {
    const dir = project([
      turn("2026-01-01T10:00:00Z", "bigger title"),
      "not json",
      '{"at":"never"}',
      "",
    ]);
    expect(readAppTurns(dir)).toEqual([
      {
        at: "2026-01-01T10:00:00Z",
        engine: "claude",
        asked: "bigger title",
        did: "Done.",
        files: ["index.html"],
      },
    ]);
  });

  it("shows only the turns after the hand-off or the newest one shown, and none without a hand-off", () => {
    const dir = project([turn("2026-01-01T10:00:00Z", "old"), turn("2026-01-01T11:00:00Z", "new")]);
    expect(unseenTurns(dir, readSeen(dir).at)).toEqual([]);
    handedOverAt(dir, "2026-01-01T09:00:00Z");
    expect(unseenTurns(dir, readSeen(dir).at).map((t) => t.asked)).toEqual(["old", "new"]);
    handedOverAt(dir, "2026-01-01T10:30:00Z");
    expect(unseenTurns(dir, readSeen(dir).at).map((t) => t.asked)).toEqual(["new"]);
  });

  it("never reads or writes a record through a link, nor through a linked folder", (context) => {
    const dir = project();
    writeFileSync(join(dir, "elsewhere.jsonl"), turn("2026-01-01T10:00:00Z", "planted"));
    try {
      symlinkSync(join(dir, "elsewhere.jsonl"), join(dir, ".hyperframes", "app-history-seen.json"));
    } catch {
      return context.skip();
    }
    expect(readSeen(dir).at).toBe(0);
    handedOverAt(dir, "2026-01-01T09:00:00Z");
    expect(readFileSync(join(dir, "elsewhere.jsonl"), "utf8")).toContain("planted");
    expect(readSeen(dir).at).toBe(Date.parse("2026-01-01T09:00:00Z"));

    const linked = mkdtempSync(join(tmpdir(), "hf-app-history-"));
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    writeFileSync(join(outside, APP_HISTORY), turn("2026-01-01T10:00:00Z", "planted"));
    symlinkSync(outside, join(linked, ".hyperframes"), "dir");
    expect(readRecord(linked, APP_HISTORY, 1024)).toBe("");
    expect(writeRecord(linked, "agent-handoff.json", "{}")).toBe(false);
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
    expect(appHistoryNotice(dir, []), "never handed over from here").toBeNull();
    handedOverAt(dir, "2026-01-01T09:00:00Z");
    expect(appHistoryNotice(dir, [])).toContain("2 chat turns");
    expect(appHistoryNotice(join(dir, ".."), [dir])).toContain(`catch-up ${basename(dir)}`);
    handedOverAt(dir, "2026-01-01T11:00:00Z");
    expect(appHistoryNotice(dir, [])).toBeNull();
  });
});

describe("addCatchUpNote", () => {
  const TEMPLATE = readFileSync(join(__dirname, "..", "templates", "_shared", "CLAUDE.md"), "utf8");
  const older = TEMPLATE.replace(`\n${CATCH_UP_NOTE}\n`, "");

  it("is the line the scaffolded instructions carry", () => {
    expect(TEMPLATE).toContain(`\n${CATCH_UP_NOTE}\n`);
    expect(older).not.toContain("catch-up");
  });

  it("adds the line to an older scaffolded CLAUDE.md and AGENTS.md, in the template's place", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-note-"));
    writeFileSync(join(dir, "CLAUDE.md"), older);
    writeFileSync(join(dir, "AGENTS.md"), older);
    addCatchUpNote(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(TEMPLATE);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(TEMPLATE);
    addCatchUpNote(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(TEMPLATE);
  });

  it("leaves the person's own instructions, a link, and a missing file alone", (context) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-note-"));
    writeFileSync(join(dir, "CLAUDE.md"), "# My notes\n");
    const outside = join(mkdtempSync(join(tmpdir(), "hf-outside-")), "AGENTS.md");
    writeFileSync(outside, older);
    try {
      symlinkSync(outside, join(dir, "AGENTS.md"));
    } catch {
      return context.skip();
    }
    addCatchUpNote(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# My notes\n");
    expect(readFileSync(outside, "utf8")).toBe(older);
    addCatchUpNote(mkdtempSync(join(tmpdir(), "hf-note-")));
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the module's ~/.hyperframes at a scratch dir before it is imported,
// so a test run never touches the developer's real streak history.
const HOME = mkdtempSync(join(tmpdir(), "hf-streaks-"));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => HOME };
});

const shouldTrack = vi.fn(() => true);
vi.mock("./client.js", () => ({ shouldTrack: () => shouldTrack() }));

const { recordLintRun, LINT_STREAK_STATE_FILE } = await import("./lintStreaks.js");

const PROJECT = "/tmp/project";
const finding = (code: string, severity = "error" as const) => ({ code, severity });

/** One lint run over a single file. */
function run(contentHash: string, codes: string[]) {
  return recordLintRun(PROJECT, [
    { file: "index.html", contentHash, findings: codes.map((c) => finding(c)) },
  ]);
}

beforeEach(() => {
  shouldTrack.mockReturnValue(true);
  rmSync(LINT_STREAK_STATE_FILE, { force: true });
});

afterEach(() => {
  rmSync(LINT_STREAK_STATE_FILE, { force: true });
});

describe("recordLintRun", () => {
  it("emits nothing on a first sighting — no edit has happened yet", () => {
    expect(run("aaa", ["gsap_from_opacity_noop"])).toEqual([]);
  });

  it("does not advance a streak when the file was not touched between runs", () => {
    run("aaa", ["gsap_from_opacity_noop"]);
    // Same content digest: `hyperframes check` re-linting an untouched project
    // must not look like an agent failing to fix something.
    expect(run("aaa", ["gsap_from_opacity_noop"])).toEqual([]);
    expect(run("aaa", ["gsap_from_opacity_noop"])).toEqual([]);
  });

  it("reports edits_to_clear when an edit removes the finding", () => {
    run("aaa", ["gsap_from_opacity_noop"]);
    const events = run("bbb", []);
    expect(events).toEqual([
      {
        code: "gsap_from_opacity_noop",
        severity: "error",
        edits: 1,
        cleared: true,
      },
    ]);
  });

  it("counts the edits a finding survives before it clears", () => {
    run("a1", ["media_missing_id"]);
    expect(run("a2", ["media_missing_id"])).toEqual([]); // 1 edit, under threshold
    expect(run("a3", ["media_missing_id"])).toEqual([]); // 2 edits
    const stuck = run("a4", ["media_missing_id"]); // 3 edits -> reported
    expect(stuck).toEqual([
      { code: "media_missing_id", severity: "error", edits: 3, cleared: false },
    ]);
    const cleared = run("a5", []);
    expect(cleared).toEqual([
      { code: "media_missing_id", severity: "error", edits: 4, cleared: true },
    ]);
  });

  it("reports an unresolved streak only once, not on every subsequent edit", () => {
    run("a1", ["media_missing_id"]);
    run("a2", ["media_missing_id"]);
    run("a3", ["media_missing_id"]);
    expect(run("a4", ["media_missing_id"])).toHaveLength(1);
    expect(run("a5", ["media_missing_id"])).toEqual([]);
    expect(run("a6", ["media_missing_id"])).toEqual([]);
  });

  it("treats a code introduced by an edit as a fresh streak, not a survivor", () => {
    run("a1", ["media_missing_id"]);
    const events = run("a2", ["media_missing_id", "video_missing_muted"]);
    // media_missing_id survived (1 edit, under threshold), video_missing_muted
    // is brand new, so neither is reportable yet.
    expect(events).toEqual([]);
    // The new code needs its own three edits before it counts as stuck.
    run("a3", ["video_missing_muted"]);
    run("a4", ["video_missing_muted"]);
    const stuck = run("a5", ["video_missing_muted"]);
    expect(stuck).toEqual([
      { code: "video_missing_muted", severity: "error", edits: 3, cleared: false },
    ]);
  });

  it("tracks each file independently", () => {
    recordLintRun(PROJECT, [
      { file: "index.html", contentHash: "i1", findings: [finding("media_missing_id")] },
      { file: "compositions/a.html", contentHash: "a1", findings: [finding("media_missing_id")] },
    ]);
    // Only index.html is edited and fixed.
    const events = recordLintRun(PROJECT, [
      { file: "index.html", contentHash: "i2", findings: [] },
      { file: "compositions/a.html", contentHash: "a1", findings: [finding("media_missing_id")] },
    ]);
    expect(events).toEqual([
      { code: "media_missing_id", severity: "error", edits: 1, cleared: true },
    ]);
  });

  it("writes no state and emits nothing when telemetry is disabled", () => {
    shouldTrack.mockReturnValue(false);
    expect(run("aaa", ["media_missing_id"])).toEqual([]);
    expect(existsSync(LINT_STREAK_STATE_FILE)).toBe(false);
  });

  it("starts clean rather than throwing when the state file is corrupt", () => {
    run("aaa", ["media_missing_id"]);
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(LINT_STREAK_STATE_FILE, "{ not json", "utf-8");
    expect(() => run("bbb", ["media_missing_id"])).not.toThrow();
  });

  it("stores no file paths or project names on disk", () => {
    run("aaa", ["media_missing_id"]);
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(LINT_STREAK_STATE_FILE, "utf-8");
    expect(raw).not.toContain("index.html");
    expect(raw).not.toContain(PROJECT);
    expect(raw).toContain("media_missing_id");
  });

  it("evicts entries that have gone stale", () => {
    const now = Date.now();
    recordLintRun(
      PROJECT,
      [{ file: "old.html", contentHash: "o1", findings: [finding("media_missing_id")] }],
      now - 30 * 24 * 60 * 60 * 1000,
    );
    recordLintRun(
      PROJECT,
      [{ file: "new.html", contentHash: "n1", findings: [finding("media_missing_id")] }],
      now,
    );
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const state = JSON.parse(readFileSync(LINT_STREAK_STATE_FILE, "utf-8")) as {
      files: Record<string, unknown>;
    };
    expect(Object.keys(state.files)).toHaveLength(1);
  });
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

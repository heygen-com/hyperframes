import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("../telemetry/config.js", () => ({
  get CONFIG_PATH() {
    return join(state.dir, "config.json");
  },
}));

import { claimDailyNotice } from "./dailyNotice.js";

const NOW = Date.parse("2026-11-04T08:00:00Z");
const HOUR = 3_600_000;
const noticeFile = () => join(state.dir, "update-notice.json");
const recorded = () => JSON.parse(readFileSync(noticeFile(), "utf-8")) as Record<string, number>;

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), "hf-daily-notice-"));
});

describe("claimDailyNotice", () => {
  it("claims once a day per project, and each project has its own day", () => {
    expect(claimDailyNotice("update", "/work/a", NOW)).toBe(true);
    expect(claimDailyNotice("update", "/work/a", NOW + HOUR)).toBe(false);
    expect(claimDailyNotice("update", "/work/b", NOW + HOUR)).toBe(true);
    expect(claimDailyNotice("update", "/work/a", NOW + 25 * HOUR)).toBe(true);
  });

  it("keeps each kind of notice apart", () => {
    expect(claimDailyNotice("skills", "/work/a", NOW)).toBe(true);
    expect(claimDailyNotice("update", "/work/a", NOW)).toBe(true);
  });

  it.each([["null"], ["[1, 2]"], ['"text"'], ["42"], ["{not json"]])(
    "reads a %s file as no showings, and repairs it on write",
    (content) => {
      writeFileSync(noticeFile(), content);
      expect(claimDailyNotice("update", "/work/a", NOW)).toBe(true);
      expect(recorded()).toEqual({ "/work/a": NOW });
    },
  );

  it("drops entries that are not times", () => {
    writeFileSync(noticeFile(), JSON.stringify({ "/work/b": "soon", "/work/c": NOW - HOUR }));
    expect(claimDailyNotice("update", "/work/a", NOW)).toBe(true);
    expect(recorded()).toEqual({ "/work/c": NOW - HOUR, "/work/a": NOW });
  });

  // A clock that moved back (or a hand-edited file) must not silence the notice for good.
  it("treats a showing in the future as stale, and does not keep it", () => {
    writeFileSync(
      noticeFile(),
      JSON.stringify({ "/work/a": NOW + 48 * HOUR, "/work/b": NOW + HOUR }),
    );
    expect(claimDailyNotice("update", "/work/a", NOW)).toBe(true);
    expect(recorded()).toEqual({ "/work/a": NOW });
  });

  it.skipIf(process.platform === "win32")("writes the file private to the user", () => {
    claimDailyNotice("update", "/work/a", NOW);
    expect(statSync(noticeFile()).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "returns false, without throwing, when the directory cannot be written",
    () => {
      chmodSync(state.dir, 0o500);
      try {
        expect(claimDailyNotice("update", "/work/a", NOW)).toBe(false);
      } finally {
        chmodSync(state.dir, 0o700);
      }
    },
  );
});

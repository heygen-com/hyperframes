// Nudge-count regression coverage: `refreshSkillsCache` must persist
// `summary.removed` (renamed/dropped skills), and the printed nudge total must
// include it — otherwise the background nudge undercounts what a plain
// `skills update` would actually reconcile (the "misleading 2 vs 3" bug).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeConfig = Record<string, unknown>;

let config: FakeConfig;

vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ ...config }),
  readConfigFresh: () => ({ ...config }),
  writeConfig: (next: FakeConfig) => {
    config = { ...next };
  },
}));

vi.mock("./updateCheck.js", () => ({
  updateNoticesSuppressed: () => false,
}));

const mockCheckSkills = vi.fn();
vi.mock("./skillsManifest.js", () => ({
  checkSkills: (...args: unknown[]) => mockCheckSkills(...args),
}));

describe("skillsUpdateCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    config = {};
    mockCheckSkills.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshSkillsCache persists the removed count alongside outdated/missing", async () => {
    mockCheckSkills.mockResolvedValue({
      location: "/home/user/.claude/skills",
      updateAvailable: true,
      summary: { current: 1, outdated: 2, missing: 3, coreMissing: 1, removed: 3 },
    });

    const { checkSkillsForUpdate } = await import("./skillsUpdateCheck.js");
    const meta = await checkSkillsForUpdate(true);

    expect(meta).toEqual({ updateAvailable: true, outdated: 2, missing: 1, removed: 3 });
    expect(config["skillsRemovedCount"]).toBe(3);
    // Must resolve against the canonical upstream manifest, not a possibly
    // stale in-repo skills-manifest.json, so this nudge agrees with what
    // `updateSkills` would actually reconcile.
    expect(mockCheckSkills).toHaveBeenCalledWith({ canonical: true });
  });

  it("does not persist anything when no install was located (nothing meaningful to cache)", async () => {
    mockCheckSkills.mockResolvedValue({
      location: null,
      updateAvailable: false,
      summary: { current: 0, outdated: 0, missing: 0, coreMissing: 0, removed: 0 },
    });

    const { checkSkillsForUpdate } = await import("./skillsUpdateCheck.js");
    await checkSkillsForUpdate(true);

    expect(config["skillsRemovedCount"]).toBeUndefined();
  });

  /** Drive printSkillsUpdateNotice from the given cache shape; returns what it wrote (if anything). */
  async function noticeTextFor(cache: FakeConfig): Promise<string | null> {
    config = cache;
    const { printSkillsUpdateNotice } = await import("./skillsUpdateCheck.js");
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    printSkillsUpdateNotice();

    if (writeSpy.mock.calls.length === 0) return null;
    expect(writeSpy).toHaveBeenCalledTimes(1);
    return String(writeSpy.mock.calls[0]?.[0]);
  }

  it("the cached nudge total counts removed skills, not just outdated/missing", async () => {
    // Cache pre-populated as if a prior refreshSkillsCache had run — only
    // outdated + missing, no removed (the pre-fix shape).
    const text = await noticeTextFor({
      skillsOutdatedCount: 1,
      skillsMissingCount: 1,
      skillsRemovedCount: 2,
    });
    // 1 outdated + 1 missing + 2 removed = 4, not the pre-fix "2".
    expect(text).toContain("4 HyperFrames skills out of date or missing");
  });

  it("prints nothing when outdated, missing, and removed are all zero", async () => {
    const text = await noticeTextFor({
      skillsOutdatedCount: 0,
      skillsMissingCount: 0,
      skillsRemovedCount: 0,
    });
    expect(text).toBeNull();
  });

  it("a removed-only count (no outdated/missing) still triggers the nudge", async () => {
    const text = await noticeTextFor({
      skillsOutdatedCount: 0,
      skillsMissingCount: 0,
      skillsRemovedCount: 1,
    });
    expect(text).toContain("1 HyperFrames skill out of date or missing");
  });

  // Regression: the stale-24h-cache bug. A successful `skills update`/install
  // never wrote the cache, and the skills commands are excluded from the nudge
  // pipeline entirely — so the pre-install "20 out of date or missing" verdict
  // kept printing on every other command until the TTL expired.
  // invalidateSkillsCache() is the fix: reconcile commands drop the cached
  // verdict so the next command re-checks for real.
  describe("invalidateSkillsCache", () => {
    const PRE_INSTALL_CACHE = {
      lastSkillsCheck: new Date().toISOString(), // fresh — inside the 24h TTL
      skillsUpdateAvailable: true,
      skillsOutdatedCount: 12,
      skillsMissingCount: 8,
      skillsRemovedCount: 0,
    };

    it("a fresh cache short-circuits the background check with the stale verdict (the bug's precondition)", async () => {
      config = { ...PRE_INSTALL_CACHE };
      const { checkSkillsForUpdate } = await import("./skillsUpdateCheck.js");

      const meta = await checkSkillsForUpdate();

      expect(mockCheckSkills).not.toHaveBeenCalled();
      expect(meta).toEqual({ updateAvailable: true, outdated: 12, missing: 8, removed: 0 });
    });

    it("drops the cached verdict so the next background check re-runs for real", async () => {
      config = { ...PRE_INSTALL_CACHE };
      mockCheckSkills.mockResolvedValue({
        location: "/home/user/.claude/skills",
        updateAvailable: false,
        summary: { current: 20, outdated: 0, missing: 0, coreMissing: 0, removed: 0 },
      });

      const { checkSkillsForUpdate, invalidateSkillsCache } =
        await import("./skillsUpdateCheck.js");
      invalidateSkillsCache();

      // All five cached fields are gone — timestamp AND counts.
      expect(config["lastSkillsCheck"]).toBeUndefined();
      expect(config["skillsUpdateAvailable"]).toBeUndefined();
      expect(config["skillsOutdatedCount"]).toBeUndefined();
      expect(config["skillsMissingCount"]).toBeUndefined();
      expect(config["skillsRemovedCount"]).toBeUndefined();

      const meta = await checkSkillsForUpdate();
      expect(mockCheckSkills).toHaveBeenCalledWith({ canonical: true });
      expect(meta).toEqual({ updateAvailable: false, outdated: 0, missing: 0, removed: 0 });
    });

    it("counts are cleared, not just the timestamp — an offline machine goes quiet instead of resurrecting stale counts", async () => {
      config = { ...PRE_INSTALL_CACHE };
      mockCheckSkills.mockRejectedValue(new Error("offline"));

      const { checkSkillsForUpdate, invalidateSkillsCache, printSkillsUpdateNotice } =
        await import("./skillsUpdateCheck.js");
      invalidateSkillsCache();

      // Refresh fails (offline) → falls back to cached meta, which is now empty.
      const meta = await checkSkillsForUpdate();
      expect(meta).toEqual({ updateAvailable: false, outdated: 0, missing: 0, removed: 0 });

      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      printSkillsUpdateNotice();
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});

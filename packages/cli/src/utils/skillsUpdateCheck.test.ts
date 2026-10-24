// Nudge-count coverage: the printed total is outdated plus missing, as cached by refreshSkillsCache.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeConfig = Record<string, unknown>;

let config: FakeConfig;
// What a process-cached readConfig() returns; null means it matches disk.
let cachedRead: FakeConfig | null = null;

vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ ...(cachedRead ?? config) }),
  readConfigFresh: () => ({ ...config }),
  writeConfig: (next: FakeConfig) => {
    config = { ...next };
  },
}));

const gate = vi.hoisted(() => ({ disabled: false, noTty: false, answers: true }));
vi.mock("./updateCheck.js", () => ({
  updateCheckDisabled: () => gate.disabled,
  updateNoticesSuppressed: () => gate.disabled || gate.noTty,
}));
vi.mock("./hostAnswers.js", () => ({ hostAnswers: async () => gate.answers }));

const mockCheckSkills = vi.fn();
vi.mock("./skillsManifest.js", () => ({
  checkSkills: (...args: unknown[]) => mockCheckSkills(...args),
}));

describe("skillsUpdateCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    config = {};
    cachedRead = null;
    mockCheckSkills.mockReset();
    gate.disabled = false;
    gate.noTty = false;
    gate.answers = true;
    vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["HYPERFRAMES_SKIP_SKILLS is set", () => vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1")],
    ["the update check is disabled (CI, dev, opt-out)", () => (gate.disabled = true)],
  ])("no background check is due when %s", async (_, arrange) => {
    const { skillsCheckDue } = await import("./skillsUpdateCheck.js");
    expect(skillsCheckDue()).toBe(true);
    arrange();
    expect(skillsCheckDue()).toBe(false);
  });

  it("a run without a TTY (an agent) still has its background check due", async () => {
    gate.noTty = true;
    const { skillsCheckDue } = await import("./skillsUpdateCheck.js");
    expect(skillsCheckDue()).toBe(true);
  });

  it("does not check skills when DNS does not answer", async () => {
    gate.answers = false;
    const { refreshSkillsCache } = await import("./skillsUpdateCheck.js");
    await refreshSkillsCache();
    expect(mockCheckSkills).not.toHaveBeenCalled();
  });

  it("writes onto a fresh read, keeping what another process wrote meanwhile", async () => {
    config = { commandCount: 1 };
    cachedRead = { ...config };
    config = { commandCount: 2 };
    mockCheckSkills.mockResolvedValue({
      location: "/home/user/.claude/skills",
      updateAvailable: false,
      summary: { current: 1, outdated: 0, missing: 0, coreMissing: 0 },
    });
    const { refreshSkillsCache } = await import("./skillsUpdateCheck.js");
    await refreshSkillsCache();
    expect(config).toMatchObject({ commandCount: 2, skillsOutdatedCount: 0 });
  });

  it("refreshSkillsCache persists the outdated and core-missing counts", async () => {
    mockCheckSkills.mockResolvedValue({
      location: "/home/user/.claude/skills",
      updateAvailable: true,
      summary: { current: 1, outdated: 2, missing: 3, coreMissing: 1 },
    });

    const { refreshSkillsCache } = await import("./skillsUpdateCheck.js");
    await refreshSkillsCache();

    expect(config).toMatchObject({
      skillsUpdateAvailable: true,
      skillsOutdatedCount: 2,
      skillsMissingCount: 1,
    });
    // Must resolve against the canonical upstream manifest, not a possibly
    // stale in-repo skills-manifest.json, so this nudge agrees with what
    // `updateSkills` would actually reconcile.
    expect(mockCheckSkills).toHaveBeenCalledWith({ canonical: true });
  });

  it("does not persist anything when no install was located (nothing meaningful to cache)", async () => {
    mockCheckSkills.mockResolvedValue({
      location: null,
      updateAvailable: false,
      summary: { current: 0, outdated: 0, missing: 0, coreMissing: 0 },
    });

    const { refreshSkillsCache } = await import("./skillsUpdateCheck.js");
    await refreshSkillsCache();
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

  it("suppresses a cached stale-skills notice in an attended plugin run", async () => {
    vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
    // The normal notice gate permits output (the attended TTY case).
    expect(await noticeTextFor({ skillsOutdatedCount: 2, skillsMissingCount: 1 })).toBeNull();
  });

  it("prints the stale-skills notice without a TTY, so an agent hears it", async () => {
    gate.noTty = true;
    const text = await noticeTextFor({ skillsOutdatedCount: 2, skillsMissingCount: 1 });
    expect(text).toContain("3 HyperFrames skills out of date or missing");
  });

  it("prints nothing when the update check is disabled (CI, dev, opt-out)", async () => {
    gate.disabled = true;
    expect(await noticeTextFor({ skillsOutdatedCount: 2, skillsMissingCount: 1 })).toBeNull();
  });

  it("prints nothing when outdated and missing are both zero", async () => {
    const text = await noticeTextFor({
      skillsOutdatedCount: 0,
      skillsMissingCount: 0,
    });
    expect(text).toBeNull();
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
    };

    it("a fresh cache short-circuits the background check with the stale verdict (the bug's precondition)", async () => {
      config = { ...PRE_INSTALL_CACHE };
      const { skillsCheckDue } = await import("./skillsUpdateCheck.js");

      expect(skillsCheckDue()).toBe(false);
    });

    it("drops the cached verdict so the next background check re-runs for real", async () => {
      config = { ...PRE_INSTALL_CACHE };
      mockCheckSkills.mockResolvedValue({
        location: "/home/user/.claude/skills",
        updateAvailable: false,
        summary: { current: 20, outdated: 0, missing: 0, coreMissing: 0 },
      });

      const { skillsCheckDue, refreshSkillsCache, invalidateSkillsCache } =
        await import("./skillsUpdateCheck.js");
      invalidateSkillsCache();

      // All four cached fields are gone — timestamp AND counts.
      expect(config["lastSkillsCheck"]).toBeUndefined();
      expect(config["skillsUpdateAvailable"]).toBeUndefined();
      expect(config["skillsOutdatedCount"]).toBeUndefined();
      expect(config["skillsMissingCount"]).toBeUndefined();
      expect(config["skillsRemovedCount"]).toBeUndefined();

      expect(skillsCheckDue()).toBe(true);
      await refreshSkillsCache();
      expect(mockCheckSkills).toHaveBeenCalledWith({ canonical: true });
      expect(config).toMatchObject({ skillsUpdateAvailable: false, skillsOutdatedCount: 0 });
    });

    it("counts are cleared, not just the timestamp — an offline machine goes quiet instead of resurrecting stale counts", async () => {
      config = { ...PRE_INSTALL_CACHE };
      mockCheckSkills.mockRejectedValue(new Error("offline"));

      const { refreshSkillsCache, invalidateSkillsCache, printSkillsUpdateNotice } =
        await import("./skillsUpdateCheck.js");
      invalidateSkillsCache();

      // Refresh fails (offline) and leaves the now-empty cache alone.
      await expect(refreshSkillsCache()).rejects.toThrow("offline");

      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      printSkillsUpdateNotice();
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});

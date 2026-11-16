import { describe, expect, it } from "vitest";
import { publishPhase, publishTransitionDecision } from "./publishTransition.js";
describe("announced 60-day publish transition", () => {
  const start = "2027-01-01T00:00:00.000Z";
  const day = 86_400_000;
  it("never starts the clock from approval or installation", () => {
    expect(publishPhase(null, Date.parse(start) + 365 * day)).toBe("unscheduled");
    expect(publishPhase(start, Date.parse(start) - 1)).toBe("unscheduled");
  });
  it("preserves exactly sixty days and guides only after the boundary", () => {
    expect(publishPhase(start, Date.parse(start))).toBe("compatibility");
    expect(publishPhase(start, Date.parse(start) + 60 * day - 1)).toBe("compatibility");
    expect(publishPhase(start, Date.parse(start) + 60 * day)).toBe("share");
  });
  it("retains legacy updates after the new-project transition", () => {
    expect(publishTransitionDecision("share", true)).toBe("keep_legacy");
    expect(publishTransitionDecision("share", false)).toBe("guide_to_share");
    expect(publishTransitionDecision("compatibility", false)).toBe("keep_legacy");
  });
  it("fails on an invalid scheduled date rather than silently switching behavior", () => {
    expect(() => publishPhase("invalid")).toThrow("timestamp");
  });
});

import { afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLegacyPublishOwner, checkPublishTransition } from "./publishTransition.js";
import { writeProjectLink, writeTeamProject } from "../utils/projectLink.js";
import { CliUsageError } from "../utils/commandResult.js";

describe("publish transition guard", () => {
  let dir: string;
  const start = "2027-01-01T00:00:00.000Z";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "publish-transition-"));
    vi.stubEnv("HYPERFRAMES_CONFIG_DIR", join(dir, "config"));
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-04-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  it("leaves the shipped window unscheduled even far in the future", () => {
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    expect(() => checkPublishTransition({ dir })).not.toThrow();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("not been scheduled"),
    );
  });
  it("guides new projects without changing their audience or uploading", () => {
    expect(() => checkPublishTransition({ dir }, start)).toThrowError(CliUsageError);
    try {
      checkPublishTransition({ dir }, start);
    } catch (error) {
      expect(error).toMatchObject({
        code: "publish_replaced",
        result: { exitCode: 2 },
        hint: expect.stringContaining("do not convert"),
      });
    }
  });
  it("keeps explicit legacy updates and stored published links", () => {
    expect(() => checkPublishTransition({ dir, update: "legacy-project" }, start)).not.toThrow();
    writeProjectLink(dir, { projectId: "legacy", url: "https://hyperframes.dev/p/legacy" });
    expect(() => checkPublishTransition({ dir }, start)).not.toThrow();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("uses the legacy update workflow"),
    );
  });
  it("keeps committed team project targets", () => {
    writeTeamProject(dir, { projectId: "legacy-team", spaceId: "team" });
    expect(() => checkPublishTransition({ dir }, start)).not.toThrow();
  });
  it("does not count an unused local identity or whitespace as a published project", () => {
    writeProjectLink(dir, { projectId: "unused", url: "" });
    expect(() => checkPublishTransition({ dir, update: "  " }, start)).toThrowError(CliUsageError);
  });
});

it("requires an owner after the window so legacy targets cannot silently create fresh projects", () => {
  expect(() => assertLegacyPublishOwner("share", false)).toThrowError(CliUsageError);
  expect(() => assertLegacyPublishOwner("share", true)).not.toThrow();
  expect(() => assertLegacyPublishOwner("compatibility", false)).not.toThrow();
  expect(() => assertLegacyPublishOwner("unscheduled", false)).not.toThrow();
});

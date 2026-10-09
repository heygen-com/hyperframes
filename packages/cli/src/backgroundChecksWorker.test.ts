import { expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(async () => ({})),
  refreshSkillsCache: vi.fn(async () => {
    throw new Error("offline");
  }),
}));
vi.mock("./utils/updateCheck.js", () => ({ checkForUpdate: checks.checkForUpdate }));
vi.mock("./utils/skillsUpdateCheck.js", () => ({ refreshSkillsCache: checks.refreshSkillsCache }));

it("runs each check it was handed, and one failing does not stop the other", async () => {
  process.argv = [process.execPath, "backgroundChecksWorker.js", "skills", "update"];

  await import("./backgroundChecksWorker.js");

  expect(checks.refreshSkillsCache).toHaveBeenCalledTimes(1);
  expect(checks.checkForUpdate).toHaveBeenCalledTimes(1);
});

it("skips a check the parent did not find due", async () => {
  vi.resetModules();
  checks.checkForUpdate.mockClear();
  process.argv = [process.execPath, "backgroundChecksWorker.js", "skills"];

  await import("./backgroundChecksWorker.js");

  expect(checks.checkForUpdate).not.toHaveBeenCalled();
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_SAFE_PERCENT,
  SAFE_BOX_PERCENTS,
  TITLE_SAFE_PERCENT,
  safeBoxInsetPercent,
} from "./previewSafeMargins";

const SKILL_PATH = join(import.meta.dirname, "../../../../skills/hyperframes-studio/SKILL.md");

describe("safe boxes", () => {
  it("are the 90% and 80% boxes, inset 5% and 10% from every edge", () => {
    expect(SAFE_BOX_PERCENTS).toEqual([90, 80]);
    expect(SAFE_BOX_PERCENTS.map(safeBoxInsetPercent)).toEqual([5, 10]);
  });
});

// Skipped until the hyperframes-studio skill exists on this branch.
describe.runIf(existsSync(SKILL_PATH))("hyperframes-studio skill matches the constants", () => {
  it("names both safe box percentages on one safe-margins line", () => {
    const skill = readFileSync(SKILL_PATH, "utf8");
    const line = skill
      .split("\n")
      .find((l) => /safe/i.test(l) && l.includes(`${ACTION_SAFE_PERCENT}%`));
    expect(line).toBeDefined();
    expect(line).toContain(`${TITLE_SAFE_PERCENT}%`);
  });
});

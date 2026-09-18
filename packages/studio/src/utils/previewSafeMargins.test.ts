import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VERTICAL_INSETS_PX,
  WIDE_ACTION_SAFE_PERCENT,
  WIDE_TITLE_SAFE_PERCENT,
  resolveSafeMargins,
} from "./previewSafeMargins";

const SKILL_PATH = join(import.meta.dirname, "../../../../skills/hyperframes-studio/SKILL.md");

describe("resolveSafeMargins", () => {
  it("draws the 93% and 90% boxes on a wide frame, captions end at the title-safe bottom", () => {
    const m = resolveSafeMargins(1920, 1080);
    expect(m.framing).toBe("wide");
    expect(m.boxes.map((b) => [b.kind, b.left, b.top])).toEqual([
      ["action", 0.035, 0.035],
      ["title", 0.05, 0.05],
    ]);
    expect(m.captionBottom).toBeCloseTo(0.95);
  });

  it("uses the pixel insets on a 1080x1920 frame, captions end above the bottom inset", () => {
    const m = resolveSafeMargins(1080, 1920);
    expect(m.framing).toBe("vertical");
    const [box] = m.boxes;
    expect([box.top, box.bottom, box.left, box.right]).toEqual([
      250 / 1920,
      484 / 1920,
      140 / 1080,
      140 / 1080,
    ]);
    expect(m.captionBottom).toBeCloseTo(1 - 484 / 1920);
  });

  it("scales the vertical insets to a smaller vertical composition", () => {
    const m = resolveSafeMargins(540, 960);
    expect(m.boxes[0].top).toBeCloseTo(250 / 1920);
  });

  it("treats a square frame as wide", () => {
    expect(resolveSafeMargins(1000, 1000).framing).toBe("wide");
  });
});

// Skipped until the hyperframes-studio skill exists on this branch.
describe.runIf(existsSync(SKILL_PATH))("hyperframes-studio skill matches the constants", () => {
  const skill = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, "utf8") : "";

  it("states the wide action-safe and title-safe percentages", () => {
    expect(skill).toContain(
      `action-safe ${WIDE_ACTION_SAFE_PERCENT}% of the frame, title-safe ${WIDE_TITLE_SAFE_PERCENT}%`,
    );
  });

  it("states the vertical insets", () => {
    const { top, bottom, left, right } = VERTICAL_INSETS_PX;
    expect(skill).toContain(
      `Insets: top ${top}, bottom ${bottom}, left ${left}, right ${right} (px)`,
    );
  });
});

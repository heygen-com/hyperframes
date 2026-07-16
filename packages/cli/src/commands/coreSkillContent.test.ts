// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf8");

describe("hyperframes-core contract docs", () => {
  it("keeps root data-start in the minimal composition skeleton", () => {
    const minimal = read("skills", "hyperframes-core", "references", "minimal-composition.md");

    expect(minimal).toMatch(/data-composition-id="main"[\s\S]{0,300}data-start="0"/);
    expect(minimal).toContain('Root `<div>` with `data-composition-id`, `data-start="0"`');
  });

  it("teaches check as the canonical quality gate", () => {
    const skill = read("skills", "hyperframes-core", "SKILL.md");
    const brief = read("skills", "hyperframes-core", "references", "brief-contract.md");

    expect(skill).toContain("`npx hyperframes check`");
    expect(brief).toContain("`hyperframes check`");
    expect(brief).not.toContain("`lint` / `validate` / `inspect`");
  });

  it("requires actionable reproduction packets in CLI defect feedback", () => {
    const skill = read("skills", "hyperframes-cli", "SKILL.md");
    const renderReference = read("skills", "hyperframes-cli", "references", "preview-render.md");

    expect(skill).toContain("reproduction packet");
    expect(renderReference).toContain("REPRO COMMAND:");
    expect(renderReference).toContain("EXPECTED / ACTUAL:");
    expect(renderReference).toContain("EXACT ERROR:");
    expect(renderReference).toContain("OUTCOME:");
    expect(renderReference).toContain("WORKAROUND:");
  });
});

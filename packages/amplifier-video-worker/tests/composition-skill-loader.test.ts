import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillBundle } from "../src/composition";

describe("loadSkillBundle", () => {
  test("reads the seven expected files from the skills root", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(root, "hyperframes"));
    mkdirSync(join(root, "gsap"));
    writeFileSync(join(root, "hyperframes", "SKILL.md"), "# hf\n");
    writeFileSync(join(root, "hyperframes", "house-style.md"), "# hs\n");
    writeFileSync(join(root, "hyperframes", "patterns.md"), "# p\n");
    writeFileSync(join(root, "hyperframes", "visual-styles.md"), "# vs\n");
    writeFileSync(join(root, "hyperframes", "data-in-motion.md"), "# dim\n");
    writeFileSync(join(root, "gsap", "SKILL.md"), "# gsap\n");
    writeFileSync(join(root, "amplifier-constraints.md"), "# constraints\n");

    try {
      const bundle = loadSkillBundle(root);
      expect(bundle.hyperframesSkill).toContain("# hf");
      expect(bundle.houseStyle).toContain("# hs");
      expect(bundle.patterns).toContain("# p");
      expect(bundle.visualStyles).toContain("# vs");
      expect(bundle.dataInMotion).toContain("# dim");
      expect(bundle.gsapSkill).toContain("# gsap");
      expect(bundle.amplifierConstraints).toContain("# constraints");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("throws a clear error when a file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    try {
      expect(() => loadSkillBundle(root)).toThrow(/SKILL\.md/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

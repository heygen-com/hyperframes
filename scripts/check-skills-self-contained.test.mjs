// `npx hyperframes skills update` installs one skills/<name> tree alone
// (packages/cli/src/commands/skills.ts). A relative import resolving outside
// skills/ is always broken there; one crossing into a sibling skill only
// survives if that sibling is core (isCoreSkill, guaranteed co-installed).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";

const SKILLS_DIR = resolve(import.meta.dirname, "..", "skills");

// Mirrors isCoreSkill in packages/cli/src/utils/skillsManifest.ts. Inlined
// (not imported) because this file must run under plain `node --test` in the
// test-skills CI job, with no tsx/TS loader available.
const isCoreSkill = (name) =>
  name === "hyperframes" || name.startsWith("hyperframes-") || name === "media-use";

const SCRIPT_FILE = /\.(?:mjs|js)$/;
const TEST_FILE = /\.test\.(?:mjs|js)$/;
// Static `import ... from "spec"` / `export ... from "spec"` / bare `import
// "spec"`, and dynamic `import("spec")` with a string-literal specifier.
const IMPORT_RE =
  /(?:\bimport\b|\bexport\b)(?:[^'"]*?\bfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function walkScripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkScripts(path));
    else if (SCRIPT_FILE.test(entry.name)) out.push(path);
  }
  return out;
}

function relativeImportSpecs(source) {
  const specs = [];
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source))) {
    const spec = match[1] ?? match[2];
    if (spec?.startsWith(".")) specs.push(spec);
  }
  return specs;
}

const topSegment = (relPath) => relPath.split(sep)[0];

export function findSkillImportViolations({ skillsDir = SKILLS_DIR } = {}) {
  const violations = [];
  for (const file of walkScripts(skillsDir)) {
    const fileRel = relative(skillsDir, file);
    const fileTop = topSegment(fileRel);
    const isTest = TEST_FILE.test(file);
    const source = readFileSync(file, "utf8");
    for (const spec of relativeImportSpecs(source)) {
      const resolvedRel = relative(skillsDir, resolve(dirname(file), spec));
      if (resolvedRel.startsWith("..")) {
        violations.push(
          `${fileRel}: imports "${spec}", which resolves outside skills/ (${resolvedRel}) — broken in an installed copy`,
        );
        continue;
      }
      const resolvedTop = topSegment(resolvedRel);
      if (resolvedTop !== fileTop && !isTest && !isCoreSkill(resolvedTop)) {
        violations.push(
          `${fileRel}: imports "${spec}" into sibling skill "${resolvedTop}", which is not a core skill and is not guaranteed to be co-installed`,
        );
      }
    }
  }
  return violations;
}

describe("skill scripts stay self-contained when installed alone", () => {
  it("has zero relative imports that escape their installed skill directory", () => {
    assert.deepEqual(findSkillImportViolations(), []);
  });

  it("flags an import that escapes skills/ entirely", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-self-contained-"));
    try {
      const skillsDir = join(root, "skills");
      mkdirSync(join(skillsDir, "demo-skill", "scripts"), { recursive: true });
      writeFileSync(
        join(skillsDir, "demo-skill", "scripts", "run.mjs"),
        'import { thing } from "../../../packages/cli/src/thing.mjs";\n',
      );
      const violations = findSkillImportViolations({ skillsDir });
      assert.equal(violations.length, 1);
      assert.match(violations[0], /resolves outside skills\//);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags a cross-skill import into a non-core sibling", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-self-contained-"));
    try {
      const skillsDir = join(root, "skills");
      mkdirSync(join(skillsDir, "demo-skill", "scripts"), { recursive: true });
      mkdirSync(join(skillsDir, "other-skill", "scripts"), { recursive: true });
      writeFileSync(join(skillsDir, "other-skill", "scripts", "lib.mjs"), "export const x = 1;\n");
      writeFileSync(
        join(skillsDir, "demo-skill", "scripts", "run.mjs"),
        'import { x } from "../../other-skill/scripts/lib.mjs";\n',
      );
      const violations = findSkillImportViolations({ skillsDir });
      assert.equal(violations.length, 1);
      assert.match(violations[0], /not a core skill/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows a cross-skill import into a core skill (media-use)", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-self-contained-"));
    try {
      const skillsDir = join(root, "skills");
      mkdirSync(join(skillsDir, "demo-skill", "scripts"), { recursive: true });
      mkdirSync(join(skillsDir, "media-use", "audio", "scripts", "lib"), { recursive: true });
      writeFileSync(
        join(skillsDir, "media-use", "audio", "scripts", "lib", "bgm.mjs"),
        "export const x = 1;\n",
      );
      writeFileSync(
        join(skillsDir, "demo-skill", "scripts", "run.mjs"),
        'import { x } from "../../media-use/audio/scripts/lib/bgm.mjs";\n',
      );
      assert.deepEqual(findSkillImportViolations({ skillsDir }), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a non-core cross-skill import from a *.test.mjs fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-self-contained-"));
    try {
      const skillsDir = join(root, "skills");
      mkdirSync(join(skillsDir, "demo-skill", "scripts"), { recursive: true });
      mkdirSync(join(skillsDir, "other-skill", "scripts"), { recursive: true });
      writeFileSync(join(skillsDir, "other-skill", "scripts", "lib.mjs"), "export const x = 1;\n");
      writeFileSync(
        join(skillsDir, "demo-skill", "scripts", "run.test.mjs"),
        'import { x } from "../../other-skill/scripts/lib.mjs";\n',
      );
      assert.deepEqual(findSkillImportViolations({ skillsDir }), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

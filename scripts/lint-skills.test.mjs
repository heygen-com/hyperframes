// Positive / negative fixture tests for the checkers exported by
// scripts/lint-skills.ts: SKILL.md frontmatter shape, registry-snapshot item
// refs, doc cross-references, and skill-root paths. Each runs against known inputs and asserts
// the violation set matches expectation.
//
// Kept in .mjs (not .ts) so `node --test` can execute it via the same runner
// the rest of scripts/*.test.mjs use; the .ts import is loaded through tsx.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSkillIndex,
  headingSlugs,
  lintDocRefs,
  lintFrontmatter,
  lintRegistryItemRefs,
  lintSkillPaths,
} from "./lint-skills.ts";

const wrap = (frontmatter) => `---\n${frontmatter}\n---\n\n# body\n`;

// ---------------------------------------------------------------------------
// Positive fixtures — must pass with zero violations
// ---------------------------------------------------------------------------

test("valid: bare required keys", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: bar"));
  assert.deepEqual(violations, []);
});

test("valid: with license (optional string)", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: bar\nlicense: MIT"));
  assert.deepEqual(violations, []);
});

test("valid: allowed-tools as YAML sequence", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: bar\nallowed-tools:\n  - Bash\n  - Read"),
  );
  assert.deepEqual(violations, []);
});

test("valid: allowed-tools as single string", () => {
  const violations = lintFrontmatter(wrap('name: foo\ndescription: bar\nallowed-tools: "Bash"'));
  assert.deepEqual(violations, []);
});

test("valid: metadata as nested mapping", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: bar\nmetadata:\n  version: 1\n  tags:\n    - a\n    - b"),
  );
  assert.deepEqual(violations, []);
});

test("valid: multi-line description via block scalar", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: |\n  Multi\n  line\n  description"),
  );
  assert.deepEqual(violations, []);
});

test("valid: description with a colon inside a quoted string", () => {
  const violations = lintFrontmatter(wrap('name: foo\ndescription: "read: file, then: write"'));
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// Negative fixtures — must produce at least one matching violation
// ---------------------------------------------------------------------------

const has = (violations, needle) =>
  violations.some((v) => v.message.toLowerCase().includes(needle.toLowerCase()));

test("invalid: missing frontmatter block", () => {
  const violations = lintFrontmatter("# just a body, no dashes\n");
  assert.ok(has(violations, "Missing SKILL.md YAML frontmatter"));
});

test("invalid: missing name", () => {
  const violations = lintFrontmatter(wrap("description: bar"));
  assert.ok(has(violations, `Missing required frontmatter key "name"`));
});

test("invalid: missing description", () => {
  const violations = lintFrontmatter(wrap("name: foo"));
  assert.ok(has(violations, `Missing required frontmatter key "description"`));
});

test("invalid: unsupported key (the 'category' drift case)", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: bar\ncategory: motion"));
  assert.ok(has(violations, `Unsupported frontmatter key "category"`));
});

test("invalid: name as a list (was silently accepted by the pre-YAML version)", () => {
  const violations = lintFrontmatter(wrap("name: [a, b]\ndescription: bar"));
  assert.ok(has(violations, `"name" must be a string`));
});

test("invalid: description as a number", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: 42"));
  assert.ok(has(violations, `"description" must be a string`));
});

test("invalid: empty description string", () => {
  const violations = lintFrontmatter(wrap('name: foo\ndescription: ""'));
  assert.ok(has(violations, `"description" must not be empty`));
});

test("invalid: allowed-tools as a mapping (must be sequence or string)", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: bar\nallowed-tools:\n  Bash: true"),
  );
  assert.ok(has(violations, `"allowed-tools" must be a string or a list of strings`));
});

test("invalid: metadata as a scalar (must be a mapping)", () => {
  const violations = lintFrontmatter(
    wrap('name: foo\ndescription: bar\nmetadata: "just a string"'),
  );
  assert.ok(has(violations, `"metadata" must be a mapping`));
});

test("invalid: malformed YAML (unmatched brace)", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: {"));
  assert.ok(has(violations, `Malformed YAML frontmatter`));
});

test("invalid: top-level scalar (frontmatter is not a mapping)", () => {
  const violations = lintFrontmatter("---\njust-a-string\n---\n\nbody");
  // Either parse succeeds and the top-level check catches it, or the parser
  // errors — either is an acceptable rejection, but the violation list must
  // be non-empty.
  assert.ok(violations.length > 0);
});

// ---------------------------------------------------------------------------
// Registry-snapshot drift guard
// ---------------------------------------------------------------------------

const KNOWN = new Set(["caption-glitch-rgb", "code-diff", "data-chart"]);
const MARKER = "<!-- registry-items: -->";

test("registry refs: unmarked file is never checked", () => {
  // Opt-in is the whole design. Most kebab-case backticks in skill docs are CSS
  // properties, data-* attributes or skill directory names, and a check that
  // flags those gets switched off. null (not []) distinguishes "not a snapshot"
  // from "a snapshot with nothing wrong", which is what the counter reports.
  assert.equal(lintRegistryItemRefs("Use `not-a-real-item` here.\n", KNOWN), null);
});

test("registry refs: a marker inside a fenced block does not arm the check", () => {
  // Otherwise a doc that documents this marker's own syntax arms the check on
  // itself, and every identifier in it starts failing for no stated reason.
  const doc = ["# Doc", "", "```md", MARKER, "```", "", "Use `not-a-real-item`."].join("\n");
  assert.equal(lintRegistryItemRefs(doc, KNOWN), null);
});

test("registry refs: marked file passes when every id is real", () => {
  const doc = `${MARKER}\n\nUse \`caption-glitch-rgb\` or \`code-diff\`.\n`;
  assert.deepEqual(lintRegistryItemRefs(doc, KNOWN), []);
});

test("registry refs: marked file flags an id the registry does not have", () => {
  const doc = `${MARKER}\n\nInstall \`text-wave-distort\` for the wobble.\n`;
  const violations = lintRegistryItemRefs(doc, KNOWN);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 3);
  assert.ok(violations[0].message.includes("text-wave-distort"));
});

test("registry refs: allow= exempts a legitimately non-item identifier", () => {
  const doc = `<!-- registry-items: allow=dark-plus,pin-rollout -->\n\n\`dark-plus\` and \`pin-rollout\`.\n`;
  assert.deepEqual(lintRegistryItemRefs(doc, KNOWN), []);
});

test("registry refs: non-id backticks are ignored", () => {
  const doc = `${MARKER}\n\n\`--json\`, \`Foo-Bar\`, \`a b-c\`, \`UPPER-CASE\`.\n`;
  assert.deepEqual(lintRegistryItemRefs(doc, KNOWN), []);
});

test("registry refs: single-word ids are a KNOWN blind spot, not an accident", () => {
  // The pattern requires a hyphen, so real single-word registry items (glitch,
  // flowchart, typewriter, confetti, separator, vignette, vignelli) are never
  // checked. Pinned here so the tradeoff is visible in code, not just in a
  // comment: dropping the hyphen would cost 46 allow= entries of prose nouns
  // across the marked files to monitor 3 more items. See lint-skills.ts header.
  const doc = `${MARKER}\n\n\`glitch\` was renamed and this doc was not updated.\n`;
  assert.deepEqual(lintRegistryItemRefs(doc, KNOWN), []);
});

// Cross-references: real temp files, since the rule asks the filesystem. Layout: skill/SKILL.md (headings
// "# Setup", "## Providers" twice), skill/references/a.md (the file under test), skill/examples/demo.html.

function refFixture() {
  const root = mkdtempSync(join(tmpdir(), "lint-skills-refs-"));
  mkdirSync(join(root, "skill", "references"), { recursive: true });
  mkdirSync(join(root, "skill", "examples"), { recursive: true });
  writeFileSync(
    join(root, "skill", "SKILL.md"),
    "---\nname: s\ndescription: d\n---\n\n# Setup\n\n## Providers\n\n## Providers\n",
  );
  writeFileSync(join(root, "skill", "examples", "demo.html"), "<html></html>\n");
  return join(root, "skill", "references", "a.md");
}

test("doc refs: relative link to an existing file passes", () => {
  const file = refFixture();
  assert.deepEqual(
    lintDocRefs(file, "See [setup](../SKILL.md) and `../examples/demo.html`.\n"),
    [],
  );
});

test("doc refs: link to a missing file is a violation naming the target", () => {
  const file = refFixture();
  const violations = lintDocRefs(file, "# Doc\n\nRead [this](../references/missing.md).\n");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 3);
  assert.ok(violations[0].message.includes("../references/missing.md"));
  assert.ok(violations[0].message.includes("does not exist"));
});

test("doc refs: path climbing above the skill root is a violation", () => {
  const file = refFixture();
  // Target exists one level up; the doc climbs two. This is the shape most of
  // the dead references on the tree had.
  const violations = lintDocRefs(file, "Open `../../examples/demo.html` for the full build.\n");
  assert.equal(violations.length, 1);
  assert.ok(violations[0].message.includes("../../examples/demo.html"));
});

test("doc refs: anchor must match a heading slug in the target", () => {
  const file = refFixture();
  assert.deepEqual(
    lintDocRefs(file, "[ok](../SKILL.md#setup) [dup](../SKILL.md#providers-1)\n"),
    [],
  );
  const violations = lintDocRefs(file, "See [preflight](../SKILL.md#preflight).\n");
  assert.equal(violations.length, 1);
  assert.ok(violations[0].message.includes("#preflight"));
  assert.ok(violations[0].message.includes("SKILL.md"));
});

test("doc refs: same-file anchor is checked against the file's own headings", () => {
  const file = refFixture();
  const doc = "# Intro\n\n## Deep Dive: Part 2!\n\n[a](#deep-dive-part-2) [b](#nope)\n";
  const violations = lintDocRefs(file, doc);
  assert.equal(violations.length, 1);
  assert.ok(violations[0].message.includes("#nope"));
});

test("doc refs: links inside fenced code blocks are ignored", () => {
  const file = refFixture();
  const doc = ["```md", "[x](./gone.md)", "`../gone.md`", "```", ""].join("\n");
  assert.deepEqual(lintDocRefs(file, doc), []);
});

test("doc refs: URLs, mailto, absolute paths and placeholders are ignored", () => {
  const file = refFixture();
  const doc = [
    "[a](https://example.com/x.md) [b](http://example.com) [c](mailto:x@y.z)",
    "[d](/etc/hosts) `../rules/<id>.md` [e](../{slug}.md)",
    "",
  ].join("\n");
  assert.deepEqual(lintDocRefs(file, doc), []);
});

test("doc refs: backticked relative .md path to a missing file is a violation", () => {
  const file = refFixture();
  const violations = lintDocRefs(file, "Follow `../references/cut-catalog.md` first.\n");
  assert.equal(violations.length, 1);
  assert.ok(violations[0].message.includes("../references/cut-catalog.md"));
});

test("doc refs: bare backticked paths are a KNOWN blind spot, not an accident", () => {
  // A bare `references/<name>.md` without a leading ./ or ../ is skill-root shorthand,
  // another skill's file, or a runtime artifact more often than a file-relative
  // path. Pinned so the tradeoff is visible in code. lintSkillPaths owns bare paths (tests below).
  const file = refFixture();
  assert.deepEqual(lintDocRefs(file, "Read `references/does-not-exist.md`.\n"), []);
});

test("doc refs: reference-style definitions are checked, footnotes are not", () => {
  const file = refFixture();
  assert.deepEqual(
    lintDocRefs(file, "[setup]: ../SKILL.md#setup\n[^1]: a footnote, not a path\n"),
    [],
  );
  const violations = lintDocRefs(file, '[gone]: <../gone.md> "Title"\n');
  assert.equal(violations.length, 1);
  assert.ok(violations[0].message.includes("../gone.md"));
});

test("doc refs: prose that merely starts with [Label]: is not a definition", () => {
  const file = refFixture();
  assert.deepEqual(lintDocRefs(file, "[Label]: describes the thing, not a path\n"), []);
});

test("doc refs: a bare # links to the top of the target, not a heading", () => {
  const file = refFixture();
  assert.deepEqual(lintDocRefs(file, "[top](#) [skill](../SKILL.md#)\n"), []);
});

test("doc refs: a target named twice on one line is reported once", () => {
  const file = refFixture();
  assert.equal(lintDocRefs(file, "[`../gone.md`](../gone.md)\n").length, 1);
});

test("doc refs: a stray ](target) without link text is not a link", () => {
  const file = refFixture();
  assert.deepEqual(lintDocRefs(file, "see the table ](../gone.md) above\n"), []);
});

test("doc refs: an existing directory target passes, with or without a fragment", () => {
  const file = refFixture();
  assert.deepEqual(
    lintDocRefs(file, "[ex](../examples) [ex2](../examples/) [ex3](../examples#x)\n"),
    [],
  );
});

test("doc refs: a directory whose name ends in .md is not anchor-checked", () => {
  const file = refFixture();
  mkdirSync(join(file, "..", "..", "notes.md"));
  assert.deepEqual(lintDocRefs(file, "[n](../notes.md#anything)\n"), []);
});

test("doc refs: fragments on non-Markdown targets are not anchor-checked", () => {
  const file = refFixture();
  assert.deepEqual(lintDocRefs(file, "[demo](../examples/demo.html#any-id)\n"), []);
});

test("doc refs: link syntax inside inline code is not a reference", () => {
  const file = refFixture();
  assert.deepEqual(lintDocRefs(file, "Write links as `[text](../gone.md)` in prose.\n"), []);
});

test("heading slugs: GitHub-style lowercasing, punctuation strip, dedupe", () => {
  const slugs = headingSlugs(
    "# Hello, World!\n## `code` & Stuff\n## Hello, World!\n```\n# not a heading\n```\n",
  );
  assert.deepEqual([...slugs], ["hello-world", "code--stuff", "hello-world-1"]);
});

// Skill-root paths: a two-skill tree. alpha/ ships references/a.md, scripts/run.mjs and a nested
// audio/scripts/tool.mjs; beta/ ships references/b.md. `dist` plays the distributed skills/ dir.

function skillsFixture() {
  const dist = mkdtempSync(join(tmpdir(), "lint-skills-paths-"));
  for (const dir of [
    "alpha/references",
    "alpha/scripts",
    "alpha/audio/references",
    "alpha/audio/scripts",
    "beta/references",
  ]) {
    mkdirSync(join(dist, dir), { recursive: true });
  }
  for (const name of ["alpha", "beta"]) {
    writeFileSync(join(dist, name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
  }
  writeFileSync(join(dist, "alpha", "references", "a.md"), "# A\n");
  writeFileSync(join(dist, "alpha", "scripts", "run.mjs"), "\n");
  writeFileSync(join(dist, "alpha", "audio", "scripts", "tool.mjs"), "\n");
  writeFileSync(join(dist, "beta", "references", "b.md"), "# B\n");
  const index = buildSkillIndex(
    [join(dist, "alpha", "SKILL.md"), join(dist, "beta", "SKILL.md")],
    dist,
  );
  return { dist, index, skill: join(dist, "alpha", "SKILL.md") };
}

test("skill paths: references that resolve pass", () => {
  const { dist, index, skill } = skillsFixture();
  const doc = [
    "Read `references/a.md`, run `node <SKILL_DIR>/scripts/run.mjs`, format per `beta/references/b.md`.",
    "Extract with `python3 <BETA_SKILL_DIR>/references/b.md`. Skills: `/alpha`, `/beta`, `/animate-text`.",
    "",
    // A skill mentioned on the previous line of the same paragraph counts (wrapped prose).
    "wiring in `/beta`",
    "`references/b.md`.",
    "",
  ].join("\n");
  assert.deepEqual(lintSkillPaths(skill, doc, index), []);
  // A nested module resolves from the referencing file upward.
  const nested = join(dist, "alpha", "audio", "references", "tts.md");
  assert.deepEqual(lintSkillPaths(nested, "`scripts/tool.mjs` and `scripts/run.mjs`\n", index), []);
});

test("skill paths: each broken reference is one violation naming its token", () => {
  const { index, skill } = skillsFixture();
  const cases = [
    ["See `references/sub-compositions.md`.", "references/sub-compositions.md"],
    ["Per `beta/b.md`.", "beta/b.md"],
    ["Per `/beta` (`references/gone.md`).", "references/gone.md"],
    ["```bash\nnode <SKILL_DIR>/phases/resolve.mjs\n```", "<SKILL_DIR>/phases/resolve.mjs"],
    ["python3 <BETA_SKILL_DIR>/scripts/gone.py", "<BETA_SKILL_DIR>/scripts/gone.py"],
    ["node <GAMMA_SKILL_DIR>/x.mjs", '"gamma"'],
    // A blank line ends the paragraph, so `/beta` no longer counts as a mention.
    ["wiring in `/beta`\n\n`references/b.md`.", "references/b.md"],
    // A bare word equal to a skill name is prose, not a mention.
    ["Run the beta CLI, then read `references/b.md`.", "references/b.md"],
    // Exists at the real repo root, but not inside an installed skill.
    ["Run `scripts/lint-skills.ts`.", "scripts/lint-skills.ts"],
  ];
  for (const [doc, token] of cases) {
    const violations = lintSkillPaths(skill, `${doc}\n`, index);
    assert.equal(violations.length, 1, doc);
    assert.ok(violations[0].message.includes(token), doc);
  }
  assert.equal(lintSkillPaths(skill, "# Doc\n\n`references/x.md`\n", index)[0].line, 3);
});

test("skill paths: skills/<name>/ is non-portable in the distributed set, checked elsewhere", () => {
  const { dist, index, skill } = skillsFixture();
  const doc = "python3 skills/beta/references/b.md\n";
  assert.ok(lintSkillPaths(skill, doc, index)[0].message.includes("installed skill"));
  // A repo-native skill runs inside the repo, where the path works if the skill exists.
  const native = buildSkillIndex([skill, join(dist, "beta", "SKILL.md")], join(dist, "elsewhere"));
  assert.deepEqual(lintSkillPaths(skill, doc, native), []);
  const retired = lintSkillPaths(skill, "node skills/retired-skill/x.mjs\n", native);
  assert.ok(retired[0].message.includes('"retired-skill"'));
});

test("skill paths: mirrored trees are each linted against their own skills", () => {
  // .claude/skills and .agents/skills hold the same names; neither may shadow the other.
  const root = mkdtempSync(join(tmpdir(), "lint-skills-mirror-"));
  const files = ["claude", "agents"].flatMap((tree) =>
    ["one", "two"].map((name) => {
      mkdirSync(join(root, tree, name, "references"), { recursive: true });
      writeFileSync(
        join(root, tree, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: d\n---\n`,
      );
      return join(root, tree, name, "SKILL.md");
    }),
  );
  writeFileSync(join(root, "claude", "two", "references", "only-here.md"), "# x\n");
  const index = buildSkillIndex(files, join(root, "distributed"));
  const doc = "See `two/references/only-here.md` and `references/nope.md`.\n";
  assert.equal(lintSkillPaths(files[0], doc, index).length, 1);
  assert.equal(lintSkillPaths(files[2], doc, index).length, 2);
});

test("skill paths: project paths, placeholders, URLs and extensionless ids are ignored", () => {
  const { index, skill } = skillsFixture();
  const doc = [
    "Write `compositions/scene.html`, `assets/logo.png`, `.hyperframes/x.json`.",
    "Templates: `references/<id>.md`, `scripts/{name}.mjs`, `references/*.md`, `$SKILL_DIR/x/$Y.mjs`.",
    "Docs at https://example.com/references/x.md and `references/some-id`.",
    "",
  ].join("\n");
  assert.deepEqual(lintSkillPaths(skill, doc, index), []);
});

test("skill paths: an unknown hyphenated /skill is a violation; hyphenless /words are not", () => {
  const { index, skill } = skillsFixture();
  const violations = lintSkillPaths(skill, "Load `/gamma-skill`; divide by `/fps`.\n", index);
  assert.equal(violations.length, 1);
  assert.ok(violations[0].message.includes("/gamma-skill"));
});

test("skill paths: every allow= marker exempts its paths and /name references", () => {
  const { index, skill } = skillsFixture();
  const doc = [
    "<!-- skill-paths: allow=references/X.md -->",
    "<!-- skill-paths: allow=references/Y.md,/upstream-skill -->",
    "",
    "See `references/X.md`, `references/Y.md` and `/upstream-skill`.",
    "",
  ].join("\n");
  assert.deepEqual(lintSkillPaths(skill, doc, index), []);
});

// fallow-ignore-file complexity
// Each case builds a real git repo in a temp dir and runs the real checker against it, because
// the resolver is git: a stub for "does this path exist" would pass while the git calls were wrong.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROBE, checkComments } from "./check-comment-citations.mjs";

const CHECKER = fileURLToPath(new URL("./check-comment-citations.mjs", import.meta.url));

const BRAND = {
  "src/brand.ts": ["export function brandKitId(kit) {", "  return kit.id;", "}", ""].join("\n"),
  "tests/brand.test.ts": [
    "import { brandKitId } from '../src/brand';",
    "brandKitId({ id: 1 });",
    "",
  ].join("\n"),
  "tests/unrelated.test.ts": ["import { other } from '../src/other';", "other();", ""].join("\n"),
};

function checkSubject(t, subject, extra = {}, scope = { kind: "all" }) {
  const root = mkdtempSync(path.join(tmpdir(), "comment-citations-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (entries) => {
    for (const [rel, body] of Object.entries(entries)) {
      mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
  };
  execFileSync("git", ["init", "-q"], { cwd: root });
  write({ ...BRAND, ...extra, ...subject });
  execFileSync("git", ["add", "-A"], { cwd: root });
  const subjectPaths = Object.keys(subject);
  const resolved =
    scope.kind === "lines"
      ? {
          kind: "lines",
          added: new Map(subjectPaths.map((file) => [file, scope.added])),
          removed: scope.removed ?? new Set(),
        }
      : scope;
  return checkComments(root, subjectPaths, resolved);
}

const oneLiner = (comment) => [comment, "export const subject = 1;", ""].join("\n");

test("a comment whose path, line, symbol and test all resolve passes", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner(
      "// The id comes from `brandKitId` in `src/brand.ts:1`, pinned by `tests/brand.test.ts`.",
    ),
  });
  assert.deepEqual(failures, []);
});

test("a cited file that does not exist fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// The shape lives in `src/gone.ts`."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /no such file/);
  assert.equal(failures[0].where, "src/subject.ts:1");
});

test("a line number past the end of a real file fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Defined at `src/brand.ts:99`."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /has only 4 lines/);
});

test("a backticked symbol that resolves nowhere fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Guarded by `missingHelperName`."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /resolves nowhere/);
});

// A symbol named two lines up in its own docblock is the citing block reading itself.
test("a symbol named only elsewhere in its own docblock still fails", (t) => {
  const { failures } = checkSubject(
    t,
    {
      "src/subject.ts": [
        "/**",
        " * The comment renames a field to fooBar, matching the doc line below.",
        " * The tests assert `fooBar` is set on write.",
        " */",
        "export const subject = 1;",
        "",
      ].join("\n"),
    },
    {},
    { kind: "lines", added: new Set([3]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /resolves nowhere/);
});

test("a pinned-by claim on a test that never names the symbol fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// `brandKitId` is pinned by `tests/unrelated.test.ts`."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /never mentions `brandKitId`/);
});

test("a citation inside a fenced markdown block is not a citation", (t) => {
  const { failures } = checkSubject(t, {
    "docs/note.md": ["Prose.", "", "```ts", "// see `src/gone.ts`", "```", "", "Done.", ""].join(
      "\n",
    ),
  });
  assert.deepEqual(failures, []);
});

test("the same markdown citation outside the fence does fail", (t) => {
  const { failures } = checkSubject(t, {
    "docs/note.md": ["Prose.", "", "see `src/gone.ts`", "", "Done.", ""].join("\n"),
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].where, "docs/note.md:3");
});

test("a slash-slash inside a multi-line template literal is code, not a comment", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": ["export const snippet = `", "// the shape lives in `,", "  ;", ""].join(
      "\n",
    ),
  });
  assert.deepEqual(failures, []);
});

test("history narration on a touched line fails the build", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// This used to be a map.") },
    {},
    { kind: "lines", added: new Set([1]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].cite, /used to be a map/);
  assert.match(failures[0].why, /narrates history/);
});

test("a broken citation on a line the diff did not touch warns instead of failing", (t) => {
  const { failures, warnings } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// The shape lives in `src/gone.ts`.") },
    {},
    { kind: "lines", added: new Set([2]) },
  );
  assert.deepEqual(failures, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].why, /no such file/);
});

test("a broken citation on a line the diff did touch fails", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// The shape lives in `src/gone.ts`.") },
    {},
    { kind: "lines", added: new Set([1]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /no such file/);
});

test("a bare filename resolves to the citing file's own package, not another's", (t) => {
  const { failures } = checkSubject(
    t,
    { "packages/web/src/subject.ts": oneLiner("// Mirrors `helper.ts:3`.") },
    {
      "packages/api/src/helper.ts": ["one", ""].join("\n"),
      "packages/web/src/helper.ts": ["one", "two", "three", ""].join("\n"),
    },
  );
  assert.deepEqual(failures, []);
});

test("a sentence asserting a name is absent is not a citation", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner(
      "// There is no `src/gone.ts` and no package sets `strictNullChecks`.",
    ),
  });
  assert.deepEqual(failures, []);
});

test("the same names without the negation still fail", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner(
      "// The shape is in `src/gone.ts`; every package sets `strictNullChecks`.",
    ),
  });
  assert.equal(failures.length, 2);
});

test("a sentence that names another repo is not this repo's to resolve", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Mirrors `publish.yml` in heygen-com/other-repo."),
  });
  assert.deepEqual(failures, []);
});

test("a sentence that names this repo is still resolved", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Mirrors `publish.yml` in heygen-com/hyperframes."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /no such file/);
});

test("a sentence that names an installed dependency is not this repo's to resolve", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// `next/dist/compiled/cookies` supplies `parseTheCookie`."),
  });
  assert.deepEqual(failures, []);
});

test("the repo a paragraph names covers a citation two lines later", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": [
      "// heygen-com/other-repo splits it the same way:",
      "// its roster hooks pass a limit, and it fetches the pack separately",
      "// through `getAvatarGroupLookList`.",
      "export const subject = 1;",
      "",
    ].join("\n"),
  });
  assert.deepEqual(failures, []);
});

test("a paragraph break ends that cover", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": [
      "// heygen-com/other-repo splits it the same way.",
      "export const between = 1;",
      "// It fetches the pack through `getAvatarGroupLookList`.",
      "export const subject = 1;",
      "",
    ].join("\n"),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].cite, /getAvatarGroupLookList/);
});

test("a negation governs a name that wrapped onto the next line", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": [
      "// No package sets `strictNullChecks`, `exactOptionalPropertyTypes` or",
      "// `noImplicitOverride`.",
      "export const subject = 1;",
      "",
    ].join("\n"),
  });
  assert.deepEqual(failures, []);
});

// No ".ts" twin of the fixture exists, so a capture truncated to ".ts" resolves nothing and reds.
test("a pinned-by claim reads the whole extension, not a prefix of it", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// `brandKitId`, see `tests/moment.test.tsx`.") },
    { "tests/moment.test.tsx": ["import { brandKitId } from '../src/brand';", ""].join("\n") },
  );
  assert.deepEqual(failures, []);
});

// --- Rule: a comment block longer than 40 lines ---------------------------------------------

const longBlock = (lines, first = "// Why this exists.") =>
  [
    first,
    ...Array.from({ length: lines - 1 }, (_, i) => `// line ${i + 2} of the explanation.`),
    "export const subject = 1;",
    "",
  ].join("\n");

test("a comment block over 40 lines fails", (t) => {
  const { failures } = checkSubject(t, { "src/subject.ts": longBlock(41) });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /over 40 lines/);
});

test("a comment block of exactly 40 lines passes", (t) => {
  const { failures } = checkSubject(t, { "src/subject.ts": longBlock(40) });
  assert.deepEqual(failures, []);
});

test("an over-long block with a reasoned comment-length marker passes", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": longBlock(
      41,
      "// comment-length: the wire protocol table, and it has to stay whole",
    ),
  });
  assert.deepEqual(failures, []);
});

test("a comment-length marker with no reason does not silence the rule", (t) => {
  const { failures } = checkSubject(t, { "src/subject.ts": longBlock(41, "// comment-length:") });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /over 40 lines/);
});

// --- Scope: the block rules grade only blocks holding a line the diff added -----------------

test("an over-long block the diff did not touch is not graded", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": longBlock(41) },
    {},
    { kind: "lines", added: new Set([42]) },
  );
  assert.deepEqual(failures, []);
});

test("one touched line inside an over-long block grades the whole block", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": longBlock(41) },
    {},
    { kind: "lines", added: new Set([20]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /over 40 lines/);
});

test("history narration in a block the diff did not touch is not graded", (t) => {
  const { failures, warnings } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// This was removed in the rewrite.") },
    {},
    { kind: "lines", added: new Set([2]) },
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, []);
});

test("history narration fails when the diff touched another line of its block", (t) => {
  const { failures } = checkSubject(
    t,
    {
      "src/subject.ts": [
        "// Both halves are load-bearing: the fallback must never commit.",
        "// The caller's own guard does not cover it.",
        "export const subject = 1;",
        "",
      ].join("\n"),
    },
    {},
    { kind: "lines", added: new Set([2]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

test("commented-out code the diff did not touch is not graded", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// const cached = readCache(key);") },
    {},
    { kind: "lines", added: new Set([2]) },
  );
  assert.deepEqual(failures, []);
});

test("commented-out code on a touched line fails", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// const cached = readCache(key);") },
    {},
    { kind: "lines", added: new Set([1]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /commented-out code/);
});

// --- Rule: history narration ------------------------------------------------------------------

test("a comment that narrates history fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// This used to read from the cache."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

// Bare "was" is excluded on purpose: this sentence states a live condition.
test("ordinary past tense that states a live condition passes", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Retry only if the response was truncated mid-frame."),
  });
  assert.deepEqual(failures, []);
});

test("a pull request number is history", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Guards the race fixed in PR #4431."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

// --- Rule: commented-out code -----------------------------------------------------------------

test("commented-out code fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// const cached = readCache(key);"),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /commented-out code/);
});

// Both contain "return" and "cached"; only one is code, which is why the rule asks the parser.
test("prose describing what the code returns passes", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Return the cached row when the key is warm."),
  });
  assert.deepEqual(failures, []);
});

test("a suppression pragma is not commented-out code", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// @ts-expect-error upstream types lag the runtime"),
  });
  assert.deepEqual(failures, []);
});

test("a well-formed TODO that names a call is not commented-out code", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// TODO: drop this once readCache(key) is memoised"),
  });
  assert.deepEqual(failures, []);
});

// --- Scope: the block rules are for code, not for the record ----------------------------------

test("a markdown file is exempt from all three block rules", (t) => {
  const { failures } = checkSubject(t, {
    "docs/plan.md": [
      "This used to read from the cache.",
      "",
      "```",
      "const cached = readCache(key);",
      "```",
      "",
    ].join("\n"),
  });
  assert.deepEqual(failures, []);
});

test("before this, meaning earlier than this one, is not history", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// How long the call gets before this route stops waiting on it."),
  });
  assert.deepEqual(failures, []);
});

test("before this change, naming the change, is history", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// Before this change the step cast every look the same way."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

// A quote reports someone else's words; rewording it would misquote them.
test("history narration inside a quotation is not this code's history", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner('// The upstream error reads "that item is no longer in this kit".'),
  });
  assert.deepEqual(failures, []);
});

test("history narration outside the quotation still fails", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner('// We used to show "that item is gone" here.'),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

// "was called" describes what the program did; only the structural verbs a commit performs fail.
test("a spy assertion using was called is not history", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// A spy proves `brandKitId` was called, not that the row landed."),
  });
  assert.deepEqual(failures, []);
});

test("a structural verb is still history", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// The helper was renamed when the rail landed."),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

test("a single-quoted quotation is skipped too", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// The upstream error reads 'that item is no longer in this kit'."),
  });
  assert.deepEqual(failures, []);
});

test("no longer states a live fact and does not fail", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": oneLiner("// A tile cannot show something the catalog no longer contains."),
  });
  assert.deepEqual(failures, []);
});

test("a file the diff does not touch is not graded", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// Nothing to see here.") },
    {
      "src/elsewhere.ts": [
        "// This half is load-bearing: the fallback must never commit.",
        "export const elsewhere = 1;",
        "",
      ].join("\n"),
    },
  );
  assert.deepEqual(failures, []);
});

// --- Rule: a name outside this repo, and a name only the merge base holds -------------------

test("a React hook names the platform, not a broken citation", (t) => {
  const { failures } = checkSubject(
    t,
    {
      "src/subject.ts": oneLiner(
        "// `useTransition` in the parent cannot carry the flag: that render suspends and never commits.",
      ),
    },
    {},
    { kind: "lines", added: new Set([1]) },
  );
  assert.deepEqual(failures, []);
});

// A sentence about a deletion has to name the deleted thing.
test("a symbol used by code this diff deletes passes", (t) => {
  const { failures } = checkSubject(
    t,
    {
      "src/subject.ts": oneLiner(
        "// The kit stops carrying `needsReview`: the verdict map owns what a review row means.",
      ),
    },
    {},
    { kind: "lines", added: new Set([1]), removed: new Set(["needsReview"]) },
  );
  assert.deepEqual(failures, []);
});

test("a symbol this diff never deleted still fails", (t) => {
  const { failures } = checkSubject(
    t,
    { "src/subject.ts": oneLiner("// Guarded by `missingHelperName`.") },
    {},
    { kind: "lines", added: new Set([1]), removed: new Set(["needsReview"]) },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /resolves nowhere/);
});

// A contraction and the trigger in one block: a naive quote pattern blanks from the apostrophe on.
test("a contraction does not blank the rest of the comment", (t) => {
  const { failures } = checkSubject(t, {
    "src/subject.ts": [
      "// It isn't obvious, but the retry is load-bearing: the second read is what settles the row.",
      "// The caller's own guard does not cover it.",
      "export const subject = 1;",
      "",
    ].join("\n"),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /narrates history/);
});

test("a react-dom export names the platform, not a broken citation", (t) => {
  const { failures } = checkSubject(
    t,
    {
      "src/subject.ts": oneLiner(
        "// `createPortal` would escape the clip, and `flushSync` inside the resize would tear the row.",
      ),
    },
    {},
    { kind: "lines", added: new Set([1]) },
  );
  assert.deepEqual(failures, []);
});

// Drives the entry point against a real two-commit repo, so `mergeBase`, `changedFiles` and
// `diffScope` are tested too. A path in `base` and absent from `head` is a file the diff deletes;
// an `overrides` entry set to undefined drops that variable.
function runCli(t, base, head, args = [], overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "comment-citations-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (entries) => {
    for (const [rel, body] of Object.entries(entries)) {
      mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
  };
  const identity = ["-c", "user.email=t@example.com", "-c", "user.name=Test"];
  const run = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" });
  run("init", "-q");
  write(base);
  run("add", "-A");
  run(...identity, "commit", "-qm", "base", "--no-gpg-sign");
  const baseSha = run("rev-parse", "HEAD").trim();
  for (const rel of Object.keys(base)) if (!(rel in head)) rmSync(path.join(root, rel));
  write(head);
  run("add", "-A");
  run(...identity, "commit", "-qm", "head", "--no-gpg-sign");

  const env = { ...process.env, COMMENT_CHECK_BASE: baseSha, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const cli = spawnSync(process.execPath, [CHECKER, ...args], { cwd: root, encoding: "utf8", env });
  return { status: cli.status, output: `${cli.stdout}${cli.stderr}` };
}

const KIT = { "src/kit.ts": ["export const needsReview = 1;", ""].join("\n") };
const explains = (symbol) =>
  oneLiner(
    `// The kit stops carrying \`${symbol}\`: the verdict map owns what a review row means.`,
  );

test("the CLI passes a citation of a symbol this diff deletes", (t) => {
  const { status, output } = runCli(t, KIT, { "src/subject.ts": explains("needsReview") });
  assert.equal(status, 0, output);
  assert.match(output, /comments: OK/);
});

test("the CLI fails a citation of a symbol no commit ever held", (t) => {
  const { status, output } = runCli(t, KIT, { "src/subject.ts": explains("missingHelperName") });
  assert.equal(status, 1, output);
  assert.match(output, /missingHelperName/);
  assert.match(output, /resolves nowhere in the repo/);
});

test("the CLI fails a commented-out block the diff adds and passes one it left alone", (t) => {
  const dead = oneLiner("// const cached = readCache(key);");
  const added = runCli(t, KIT, { ...KIT, "src/subject.ts": dead });
  assert.equal(added.status, 1, added.output);
  assert.match(added.output, /commented-out code/);
  const base = { ...KIT, "src/subject.ts": dead };
  const untouched = runCli(t, base, {
    ...base,
    "src/subject.ts": `${dead}export const more = 2;\n`,
  });
  assert.equal(untouched.status, 0, untouched.output);
});

test("a hand-run sweep grades a checkout that has no origin", (t) => {
  const subject = oneLiner("// The id comes from `brandKitId` in `src/brand.ts:1`.");
  const head = { ...BRAND, "src/subject.ts": subject };
  const { status, output } = runCli(t, KIT, head, ["src/subject.ts"], {
    COMMENT_CHECK_BASE: undefined,
  });
  assert.equal(status, 0, output);
  assert.match(output, /comments: OK/);
});

test("a sweep with no origin still fails a citation that resolves nowhere", (t) => {
  const head = { ...BRAND, "src/subject.ts": explains("missingHelperName") };
  const { status, output } = runCli(t, KIT, head, ["src/subject.ts"], {
    COMMENT_CHECK_BASE: undefined,
  });
  assert.equal(status, 1, output);
  assert.match(output, /missingHelperName/);
});

// Editing a comment removes its old line, which carries the stale name. Waiving on removed lines
// would pass this; waiving on removed code fails it.
test("a citation already broken at the fork point fails when its line is edited", (t) => {
  const rotted = (verb) =>
    oneLiner(`// The retry is settled by \`rottedName\` before the row is ${verb}.`);
  const { status, output } = runCli(
    t,
    { ...KIT, "src/subject.ts": rotted("written") },
    { ...KIT, "src/subject.ts": rotted("committed") },
  );
  assert.equal(status, 1, output);
  assert.match(output, /rottedName/);
});

// A `//` inside a string drops the rest of that removed line, so the name is not waived.
test("a name behind a slash-slash inside a string is not read as deleted code", (t) => {
  const base = {
    "src/kit.ts": ['export const docs = "https://example.com/needsReview";', ""].join("\n"),
  };
  const { status, output } = runCli(t, base, { "src/subject.ts": explains("needsReview") });
  assert.equal(status, 1, output);
  assert.match(output, /needsReview/);
});

// A removed line opening with `*` is block-comment text, so its names cannot waive anything.
test("a name inside a removed block comment is not read as deleted code", (t) => {
  const base = {
    "src/kit.ts": [
      "/**",
      " * Settled by needsReview before the write.",
      " */",
      "export const kit = 1;",
      "",
    ].join("\n"),
  };
  const head = {
    "src/kit.ts": ["export const kit = 1;", ""].join("\n"),
    "src/subject.ts": explains("needsReview"),
  };
  const { status, output } = runCli(t, base, head);
  assert.equal(status, 1, output);
  assert.match(output, /needsReview/);
});

const wallFile = (first) =>
  [
    first,
    ...Array.from({ length: 41 }, (_, i) => `// line ${i + 2} of the table.`),
    "export const w = 1;",
    "",
  ].join("\n");

// A pathspec of only the new path stops git pairing the rename, and the whole file reads as added.
test("a pure rename does not grade the file's old comments", (t) => {
  const old = { "src/a.ts": wallFile("// Why this exists.") };
  const { status, output } = runCli(t, old, { "src/b.ts": old["src/a.ts"] });
  assert.equal(status, 0, output);
});

test("deleting a block's comment-length marker grades the wall it leaves", (t) => {
  const base = {
    "src/a.ts": wallFile("// comment-length: a protocol table, it has to stay whole"),
  };
  const head = { "src/a.ts": base["src/a.ts"].split("\n").slice(1).join("\n") };
  const { status, output } = runCli(t, base, head);
  assert.equal(status, 1, output);
  assert.match(output, /comment block/);
});

test("deleting a code line next to an old wall does not grade the wall", (t) => {
  const base = { "src/a.ts": `export const gone = 0;\n${wallFile("// Why this exists.")}` };
  const { status, output } = runCli(t, base, { "src/a.ts": wallFile("// Why this exists.") });
  assert.equal(status, 0, output);
});

test("deleting a TypeScript private field next to an old wall does not grade the wall", (t) => {
  const base = { "src/a.ts": `  #count = 0;\n${wallFile("// Why this exists.")}` };
  const { status, output } = runCli(t, base, { "src/a.ts": wallFile("// Why this exists.") });
  assert.equal(status, 0, output);
});

// --- A run that examined nothing must not report success --------------------------------------

test("a git ref handed in as an argument is refused, not counted as a file checked", (t) => {
  const rot = oneLiner("// The shape lives in `src/gone.ts`.");
  const { status, output } = runCli(t, KIT, { ...KIT, "src/subject.ts": rot }, ["origin/main"]);
  assert.equal(status, 2, output);
  assert.match(output, /examined 0 of the 1 argument\(s\) given/);
  assert.doesNotMatch(output, /OK/);
});

test("a sweep of only unscannable files fails instead of reporting a pass", (t) => {
  const head = { ...KIT, "docs/thing.json": "{}\n" };
  const { status, output } = runCli(t, KIT, head, ["docs/thing.json"]);
  assert.equal(status, 2, output);
  assert.match(output, /examined 0/);
});

test("the OK line reports how many files were examined, not how many were named", (t) => {
  const clean = oneLiner("// The id comes from `brandKitId` in `src/brand.ts:1`.");
  const head = { ...BRAND, ...KIT, "src/subject.ts": clean, "docs/thing.json": "{}\n" };
  const { status, output } = runCli(t, KIT, head, ["src/subject.ts", "docs/thing.json"]);
  assert.equal(status, 0, output);
  assert.match(output, /OK \(1 file\(s\) examined of 2 in scope\)/);
});

test("a diff of only unscannable files says so instead of reporting a pass", (t) => {
  const { status, output } = runCli(t, KIT, { ...KIT, "docs/thing.json": "{}\n" });
  assert.equal(status, 0, output);
  assert.match(output, /nothing to check \(1 changed file\(s\), none scannable\)/);
  assert.doesNotMatch(output, /OK/);
});

// The probe's two citations use independent resolvers, so each must report on its own.
test("the built-in probe still carries a citation of each kind this checker refuses", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { failures } = checkComments(root, [PROBE], { kind: "all" });
  const why = failures.map((failure) => failure.why).join("\n");
  assert.match(
    why,
    /no such file|does not exist/,
    "the path arm of the self-check reported nothing",
  );
  assert.match(why, /resolves nowhere/, "the symbol arm of the self-check reported nothing");
});

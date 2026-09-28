#!/usr/bin/env node
// fallow-ignore-file complexity
// A changed source file's comment share may not rise versus its own copy at the merge-base, and it
// may not gain a comment block over 12 lines. A new file may not open above its package's share.
// Rules and reasons: CONTRIBUTING.md, "Comments". Line counting is owned by the citation checker.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { commentBlocks } from "./check-comment-citations.mjs";

const MAX_BLOCK_LINES = 12;

// Product source only: a test's table of cases reads as comment and is the test's content.
export const isSource = (path) =>
  /^packages\/[^/]+\/src\/.+\.tsx?$/.test(path) && !/\.(d|test|spec)\.tsx?$/.test(path);

const packageOf = (path) => path.split("/").slice(0, 2).join("/");

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256e6 });

// `-M` names both paths of a rename, so a renamed file keeps its own history instead of being
// graded as new.
export function changedPaths(nameStatus) {
  return nameStatus
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      const [from, to] = /^[RC]\d*$/.test(status) ? paths : [paths[0], paths[0]];
      return { status: status[0], from, to };
    })
    .filter((entry) => entry.from !== undefined && entry.to !== undefined);
}

// Volume counts lines carrying prose, not a block's span: deleting the code between two blocks
// merges their spans, which would read as comments appearing from nowhere.
export function measure(source, ext) {
  const blocks = commentBlocks(source, ext);
  const span = (block) => block.end - block.start + 1;
  return {
    lines: source.split("\n").length,
    comment: blocks.reduce((total, block) => total + block.textLines, 0),
    long: blocks.filter((block) => !block.marked && span(block) > MAX_BLOCK_LINES).length,
  };
}

const share = (entry) => (entry.lines === 0 ? 0 : entry.comment / entry.lines);
const percent = (entry) => `${(share(entry) * 100).toFixed(1)}% (${entry.comment}/${entry.lines})`;

const WALL_ADVICE =
  `    Cut it to the why and the invariant, or mark its first line "comment-length: <reason>"\n` +
  `    if it genuinely must stay (a licence, a diagram, a protocol table).`;

// `base` is the file at the merge-base, or null when new. Share fails only when comment lines
// were added too, since deleting code lifts the share of comments nobody touched.
export function judge(file, head, base, packageShare) {
  const problems = [];
  if (base === null) {
    if (share(head) > packageShare) {
      problems.push(
        `NEW file over its package's comment share: ${file} is ${percent(head)}, the package is ` +
          `${(packageShare * 100).toFixed(1)}%\n` +
          `    A new file starts at or under what its package already carries. Cut the prose, or\n` +
          `    move the explanation into a name or a type.`,
      );
    }
    if (head.long > 0) {
      problems.push(
        `NEW comment block over ${MAX_BLOCK_LINES} lines: ${file} has ${head.long}\n${WALL_ADVICE}`,
      );
    }
    return problems;
  }
  if (share(head) > share(base) && head.comment > base.comment) {
    problems.push(
      `RAISED comment share: ${file} is ${percent(head)}, at the base ${percent(base)}\n` +
        `    ${head.comment - base.comment} comment line(s) added. Cut them, or move the explanation\n` +
        `    into a name or a type. A file's comment share may only go down.`,
    );
  }
  if (head.long > base.long) {
    problems.push(
      `NEW comment block over ${MAX_BLOCK_LINES} lines: ${file} has ${head.long}, the base has ${base.long}\n${WALL_ADVICE}`,
    );
  }
  return problems;
}

// Untrimmed: dropping the trailing newline shortens the base by a line and raises its share.
function atBase(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", stdio: "pipe" });
  } catch {
    return null;
  }
}

// The bar for a new file: its package's share over files that existed at the base, so new files
// never set their own bar. A package that is new as a whole is held to every package's share.
function packageTotal(dir, isNew) {
  return git(["ls-files", dir])
    .split("\n")
    .filter((file) => isSource(file) && !isNew.has(file))
    .reduce(
      (sum, file) => {
        const entry = measure(readFileSync(file, "utf8"), extname(file));
        return { lines: sum.lines + entry.lines, comment: sum.comment + entry.comment };
      },
      { lines: 0, comment: 0 },
    );
}

function packageShare(pkg, isNew) {
  const own = packageTotal(`${pkg}/src`, isNew);
  return share(own.lines > 0 ? own : packageTotal("packages", isNew));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const ref = git(["merge-base", process.env.COMMENT_CHECK_BASE ?? "origin/main", "HEAD"]).trim();
  // Against the working tree, where contents are read from; in CI that is HEAD.
  const changed = changedPaths(git(["diff", "--name-status", "-M", ref, "--", "packages"]))
    .filter(({ status, to }) => status !== "D" && isSource(to))
    .sort((a, b) => a.to.localeCompare(b.to));

  const graded = changed.map(({ from, to }) => ({ to, onBase: atBase(ref, from) }));
  const isNew = new Set(graded.filter(({ onBase }) => onBase === null).map(({ to }) => to));
  const shares = new Map();
  const problems = [];
  for (const { to, onBase } of graded) {
    const head = measure(readFileSync(to, "utf8"), extname(to));
    const pkg = packageOf(to);
    if (onBase === null && !shares.has(pkg)) shares.set(pkg, packageShare(pkg, isNew));
    const base = onBase === null ? null : measure(onBase, extname(to));
    problems.push(...judge(to, head, base, shares.get(pkg) ?? 0));
  }

  const short = git(["rev-parse", "--short", ref]).trim();
  if (problems.length === 0) {
    console.log(
      `comment-ratchet: ${changed.length} changed source file(s) at or under their share at the merge-base ${short}.`,
    );
    process.exit(0);
  }
  for (const problem of problems) console.error(problem);
  console.error(
    `\n${problems.length} problem(s) across ${changed.length} changed source file(s), against the merge-base ${short}.`,
  );
  process.exit(1);
}

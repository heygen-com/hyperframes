#!/usr/bin/env node
// fallow-ignore-file complexity
// Grades the comments of the files a PR changed; the rules and their reasons are in CONTRIBUTING.md.
// Citations (path, path:line, backticked camelCase symbol, "pinned by <file>") must resolve.
// Blocks the diff touched may not run past 40 lines, narrate history, or be commented-out code.
// Only lines the diff added can fail; the same finding elsewhere in the file is printed, not failed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SCANNABLE = new Set([".ts", ".tsx", ".mjs", ".js", ".css", ".py", ".md"]);
// The lookahead keeps `ts` from matching inside ".tsx" and `js` inside ".json".
const PATH_EXT = "(?:ts|tsx|js|jsx|mjs|cjs|css|scss|py|md|json|ya?ml|sql|sh|html|txt)(?![\\w])";
const PATHISH = new RegExp(`^[\\w@./-]*[\\w-]+\\.${PATH_EXT}$`);
const BARE_PATH_LINE = new RegExp(`\\b([\\w@./-]*[\\w-]+\\.${PATH_EXT}):(\\d+)\\b`, "g");
const TEST_CLAIM = new RegExp(
  `\\b(pinned by|asserted in|covered by|see)\\s+\`?([\\w@./-]*[\\w-]+\\.${PATH_EXT})\`?`,
  "gi",
);

// A name cited to say it is absent ("no `danger.js`") must not be resolved. Bound to one sentence,
// reaching back far enough to cover a wrapped three-item list.
const ASSERTS_ABSENCE =
  /\b(no|not|never|without|neither|nor|nothing|absent|missing)\b[^.;]{0,120}$/i;

// A sentence that names another repo or an installed package cites a file this checkout cannot see.
const NAMES_ANOTHER_REPO = /\bheygen-com\/(?!hyperframes\b)[\w.-]+/i;
const NAMES_A_DEPENDENCY = /@[\w.-]+\/[\w.-]+|\b[\w.-]+@\d+\.\d+|\b[\w.-]+\/dist\//;

// The block rules read code only: a markdown plan describing what the code once did is a record.
const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".py"]);
const MAX_BLOCK_LINES = 40;

// Bounded forms only: bare "was" also matches live conditions ("if the response was truncated").
const HISTORY_NARRATION =
  /\b(used to|previously|formerly|load[- ]bearing|before this (?:change|commit|PR|fix|refactor|rewrite|version|landed)|(?:before|after|in|per) #\d+|PRs? #\d+|was (?:removed|renamed|replaced|moved|split|deleted|introduced|reverted))\b/i;

// Quoted words are someone else's, not this code's history. The single-quote form needs word
// boundaries and one line, or an apostrophe in "isn't" opens a span that blanks real findings.
const QUOTED_SPAN = /"[^"\n]*"|(?<![A-Za-z0-9])'[^'\n]*'(?![A-Za-z0-9])/g;

// Exempts a block from the length rule, only with a stated reason.
const LENGTH_MARKER = /comment-length:\s*(\S.*?)\s*$/;

// Pragmas and TODOs parse as code and are not code (the ruff ERA001 false-positive classes).
const PRAGMA =
  /^\s*(?:@ts-|eslint-|prettier-|biome-|oxlint-|istanbul |c8 |v8 |type:|noqa|pylint:|mypy:|TODO|FIXME|NOTE|XXX|HACK|ponytail:|comment-length:)/i;

// A bare identifier or string literal parses clean and means nothing; these bind or have an effect.
const REAL_STATEMENT = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
]);

// Platform names git grep cannot find in this repo. Listed, not read from node_modules, so the
// verdict does not depend on an install. Taken at react and react-dom 19.2.4.
const REACT_EXPORTS = [
  "cacheSignal",
  "captureOwnerStack",
  "cloneElement",
  "createContext",
  "createElement",
  "createRef",
  "forwardRef",
  "isValidElement",
  "startTransition",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
];
const REACT_DOM_EXPORTS = [
  "createPortal",
  "createRoot",
  "flushSync",
  "hydrateRoot",
  "prefetchDNS",
  "preinitModule",
  "preloadModule",
  "requestFormReset",
  "useFormState",
  "useFormStatus",
];

// Grow this when the gate flags a real name that lives outside the repo.
const ALLOW = new Set([
  "canParse",
  "showModal",
  "requestIdleCallback",
  "webkitAnimationEnd",
  "targetOrigin",
  ...REACT_EXPORTS,
  ...REACT_DOM_EXPORTS,
]);

// A URL, an absolute path, a `<sha>:<path>`, or build output: none of these resolve in the tree.
function namesSomethingElse(cited) {
  if (cited.startsWith("/") || cited.startsWith("~")) return true;
  if (cited.includes(":")) return true;
  return cited.split("/")[0] === "dist";
}

/** Of several files that could satisfy one citation, the one sharing the most leading path
 *  segments with the file doing the citing. */
function nearestTo(from, candidates) {
  if (candidates.length === 0) return null;
  const home = from.split("/");
  const shared = (file) => {
    const parts = file.split("/");
    let i = 0;
    while (i < home.length && i < parts.length && home[i] === parts[i]) i++;
    return i;
  };
  return candidates.reduce((best, file) => (shared(file) > shared(best) ? file : best));
}

/** Blank out string literals so a `//` inside one is not read as a comment, and so a template
 *  literal's backticks are not read as a citation. Length is preserved to keep offsets honest. */
function stripStrings(line) {
  return line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => " ".repeat(m.length));
}

function scanCLike(lines) {
  const out = [];
  let inBlock = false;
  let inTemplate = false;
  for (let i = 0; i < lines.length; i++) {
    let rest = lines[i];
    let text = "";
    while (rest.length > 0) {
      if (inBlock) {
        const end = rest.indexOf("*/");
        if (end === -1) {
          text += rest;
          break;
        }
        text += rest.slice(0, end);
        inBlock = false;
        rest = rest.slice(end + 2);
        continue;
      }
      if (inTemplate) {
        const end = rest.indexOf("`");
        if (end === -1) break;
        inTemplate = false;
        rest = rest.slice(end + 1);
        continue;
      }
      // Complete literals are blanked, so a backtick left over opens a multi-line template.
      const code = stripStrings(rest);
      const marks = [
        [code.indexOf("//"), "line"],
        [code.indexOf("/*"), "block"],
        [code.indexOf("`"), "template"],
      ]
        .filter(([at]) => at !== -1)
        .sort((a, b) => a[0] - b[0]);
      if (marks.length === 0) break;
      const [at, kind] = marks[0];
      if (kind === "template") {
        inTemplate = true;
        rest = rest.slice(at + 1);
        continue;
      }
      if (kind === "block") {
        inBlock = true;
        rest = rest.slice(at + 2);
        continue;
      }
      if (rest[at - 1] === ":") {
        rest = rest.slice(at + 2); // a URL, not a comment
        continue;
      }
      text += rest.slice(at + 2);
      break;
    }
    const cleaned = text.replace(/^\s*\*+ ?/, "");
    if (cleaned.trim()) out.push({ line: i + 1, text: cleaned });
  }
  return out;
}

function scanPython(lines) {
  const out = [];
  let doc = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (doc !== null) {
      const end = raw.indexOf(doc);
      out.push({ line: i + 1, text: end === -1 ? raw : raw.slice(0, end) });
      if (end !== -1) doc = null;
      continue;
    }
    const opener = raw.match(/("""|''')/);
    if (opener) {
      const rest = raw.slice(opener.index + 3);
      const end = rest.indexOf(opener[1]);
      out.push({ line: i + 1, text: end === -1 ? rest : rest.slice(0, end) });
      if (end === -1) doc = opener[1];
      continue;
    }
    const hash = stripStrings(raw).indexOf("#");
    if (hash !== -1) out.push({ line: i + 1, text: raw.slice(hash + 1) });
  }
  return out;
}

/** Markdown is prose all the way down, so every line outside a fence counts as a comment. */
function scanMarkdown(lines) {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const marker = raw.match(/^\s*(```+|~~~+)/);
    if (fence !== null) {
      if (marker && raw.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (raw.trim()) out.push({ line: i + 1, text: raw });
  }
  return out;
}

// A comment is a paragraph: the repo a name belongs to is often named a line or two above it.
function groupComments(comments) {
  const blocks = [];
  for (const comment of comments) {
    const previous = blocks[blocks.length - 1];
    if (previous && comment.line === previous[previous.length - 1].line + 1) previous.push(comment);
    else blocks.push([comment]);
  }
  return blocks;
}

// Code blocks merge across blank continuation lines, so a symbol cited deep in a docblock
// excludes the whole docblock when its own occurrences are counted.
function withBlockContext(comments, lines, ext) {
  const blocks = CODE_EXT.has(ext)
    ? mergeAcrossBlankLines(groupComments(comments), lines)
    : groupComments(comments);
  return blocks.flatMap((block) => {
    const context = block.map((comment) => comment.text).join(" ");
    const blockStart = block[0].line;
    const blockEnd = block.spanEnd ?? block[block.length - 1].line;
    // `prefix` is what the paragraph said before this line, so a negation governs a wrapped name.
    return block.map((comment, index) => ({
      ...comment,
      context,
      prefix: block
        .slice(0, index)
        .map((earlier) => earlier.text)
        .join(" "),
      blockStart,
      blockEnd,
    }));
  });
}

// A blank " *" line inside a docblock is still inside it; the text scan drops it, so length
// measures the physical span by stepping over these.
const BLANK_CONTINUATION = /^\s*(?:\/\/+|\*|\/\*\*?)?\s*$/;

function mergeAcrossBlankLines(blocks, lines) {
  const merged = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    const gapStart = previous ? previous[previous.length - 1].line : 0;
    const gap = previous ? lines.slice(gapStart, block[0].line - 1) : null;
    if (previous && gap.length > 0 && gap.every((line) => BLANK_CONTINUATION.test(line))) {
      previous.push(...block);
      previous.spanEnd = block[block.length - 1].line;
    } else {
      const copy = [...block];
      copy.spanEnd = block[block.length - 1].line;
      merged.push(copy);
    }
  }
  return merged;
}

const blocksOf = (lines, ext) => mergeAcrossBlankLines(groupComments(scanFor(lines, ext)), lines);

function scanFor(lines, ext) {
  if (ext === ".md") return scanMarkdown(lines);
  if (ext === ".py") return scanPython(lines);
  return scanCLike(lines);
}

// Asks the TypeScript parser, not a word list: prose puts two identifiers side by side, which is
// a syntax error, so clean diagnostics plus one binding or effectful statement means code.
function looksLikeCommentedOutCode(block) {
  const texts = block.map((comment) => comment.text.trim()).filter(Boolean);
  if (texts.length === 0 || texts.some((text) => PRAGMA.test(text))) return false;
  const source = texts.join("\n");
  if (source.length < 6) return false;
  // Parenthesised prose parses as a call; copied-out code keeps its formatter's terminator.
  if (!/[;}]$/.test(source.trim())) return false;
  const parsed = ts.createSourceFile(
    "comment.tsx",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  if (parsed.parseDiagnostics.length > 0) return false;
  return parsed.statements.some((node) => {
    if (REAL_STATEMENT.has(node.kind)) return true;
    if (!ts.isExpressionStatement(node)) return false;
    const expression = node.expression;
    return (
      ts.isCallExpression(expression) ||
      ts.isAwaitExpression(expression) ||
      (ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    );
  });
}

// Opener through closer line: a docblock's bare `/**` and `*/` carry no text but a reader
// still scrolls past them.
function physicalExtent(block, lines) {
  let start = block[0].line;
  let end = block.spanEnd ?? block[block.length - 1].line;
  while (start > 1 && /^\s*\/\*+\s*$/.test(lines[start - 2])) start--;
  while (end < lines.length && /^\s*\*+\/\s*$/.test(lines[end])) end++;
  return { start, end };
}

// Every comment block in one source. `textLines` counts lines carrying prose, which a volume
// measure needs: a span grows when deleting code merges two blocks.
export function commentBlocks(source, ext) {
  const lines = source.split("\n");
  const blocks = blocksOf(lines, ext);
  return blocks.map((block) => ({
    ...physicalExtent(block, lines),
    textLines: block.length,
    marked: LENGTH_MARKER.test(block[0].text.trim()),
  }));
}

// Length, narration and commented-out code need no citation to be wrong. `touches(file, start,
// end)` limits them to blocks holding a line the diff added.
export function checkBlockRules(files, repo, touches = () => true) {
  const failures = [];
  for (const file of files) {
    const ext = path.extname(file);
    if (!CODE_EXT.has(ext) || !repo.has(file)) continue;
    const lines = repo.source(file).split("\n");
    for (const block of blocksOf(lines, ext)) {
      const extent = physicalExtent(block, lines);
      if (!touches(file, extent.start, extent.end)) continue;
      const where = `${file}:${block[0].line}`;
      const first = block[0].text.trim();
      const joined = block.map((comment) => comment.text).join(" ");

      const span = extent.end - extent.start + 1;
      if (span > MAX_BLOCK_LINES && !LENGTH_MARKER.test(first)) {
        failures.push({
          where,
          cite: `${span}-line comment block`,
          why: `over ${MAX_BLOCK_LINES} lines. Cut it to the why and the invariant, or mark the first line "comment-length: <reason>" if it genuinely must stay (a licence, a diagram, a protocol table).`,
        });
      }

      const history = joined.replace(QUOTED_SPAN, '""').match(HISTORY_NARRATION);
      if (history) {
        failures.push({
          where,
          cite: joined.trim().slice(0, 100),
          why: `narrates history ("${history[1]}"). Delete the sentence; git owns what this used to be. If it also states a live invariant, keep only that clause.`,
        });
      }

      if (looksLikeCommentedOutCode(block)) {
        failures.push({
          where,
          cite: joined.trim().slice(0, 100),
          why: "parses as code, so it is commented-out code. Delete it; git owns it.",
        });
      }
    }
  }
  return failures;
}

// `#` opens a comment only in Python; in TypeScript it opens a private field.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const HASH_COMMENT_LINE = /^\s*#/;
const isCommentLine = (line, ext) =>
  COMMENT_LINE.test(line) || (ext === ".py" && HASH_COMMENT_LINE.test(line));

// A TODO names who owns it or the issue that tracks it. Only a marker opening a comment line
// counts; a sentence that mentions a TODO is prose.
const TODO_MARK = /^\s*(?:TODO|FIXME|XXX)\s*[:(]/;
// An owner is a person or an area (`jrs`, `player-perf`, `core follow-up`), or an issue.
const OWNER = "(?:@?[A-Za-z][\\w .-]*|#\\d+)";
const TODO_OWNED = new RegExp(`\\b(?:TODO|FIXME|XXX)\\s*\\(${OWNER}(?:,\\s*${OWNER})*\\)`);
// Owner or issue go in the parentheses, `TODO(name):` or `TODO(#1234):`: a bare `#123456` could be a
// colour. Otherwise the TODO's own line links the issue.
const ISSUE_LINK = /github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;
const COPIED = /\b(?:copied|adapted|ported|borrowed) from\b/i;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]*/g;
// Loopback is left alone: comments describe dev servers and CORS origins by it, not as links.
const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/i;
const PRIVATE_HOST =
  /^(?:10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|169\.254(?:\.\d+){2})$|\.(?:local|internal|lan|corp|intranet)$/;
const SIGNED_QUERY =
  /[?&](?:X-Amz-Signature|X-Amz-Credential|X-Goog-Signature|Signature|sig|token|access_token|Key-Pair-Id)=/i;
// prettier-ignore
const STOP_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "to", "of", "for", "in", "on", "at", "by", "with",
  "and", "or", "is", "are", "be", "it", "its", "we", "our", "if", "then", "else", "as", "from",
]);
const words = (text) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z][a-z0-9]*/g) ?? [];

// Why a URL in a comment cannot be followed by a reader, or null when it can. Placeholders
// (`https://${host}`, `https://<host>`) are templates, not links.
function urlProblem(raw) {
  const cited = raw.replace(/[.,;:!?]+$/, "");
  if (/^https?:\/\/$/.test(cited) || /[{}$*…]/.test(cited) || LOOPBACK.test(cited)) return null;
  let url;
  try {
    url = new URL(cited);
  } catch {
    return "is not a well-formed URL";
  }
  if (PRIVATE_HOST.test(url.hostname.toLowerCase()))
    return `points at a private host (${url.hostname})`;
  if (SIGNED_QUERY.test(url.search)) return "carries a signature or token in its query";
  return null;
}

const RESTATE_SHARE = 0.8;
const DIVIDER = /[─━═]{2,}|-{4,}|={4,}/;

// A standalone comment of one or two lines whose words are almost all names on the next code line.
// Section dividers and JSDoc are left alone: they label and document, they do not narrate.
function restatesCode(block, lines, extent, ext) {
  if (block.length > 2 || !isCommentLine(lines[block[0].line - 1], ext)) return false;
  if (/^\s*\/\*\*/.test(lines[extent.start - 1]) || block.some(({ text }) => DIVIDER.test(text))) {
    return false;
  }
  const next = lines.slice(extent.end).find((line) => line.trim());
  if (!next || isCommentLine(next, ext) || /^\s*}/.test(next)) return false;
  const said = words(block.map((comment) => comment.text).join(" ")).filter(
    (w) => !STOP_WORDS.has(w),
  );
  if (said.length < 2) return false;
  const code = new Set(words(stripStrings(next)));
  return said.filter((w) => code.has(w)).length / said.length >= RESTATE_SHARE;
}

// Findings for the checkable best-practice rules, each with the line range it rests on. Pure, so
// the same function grades a PR and measures the whole tree.
export function practiceFindings(source, ext) {
  if (!CODE_EXT.has(ext)) return [];
  const lines = source.split("\n");
  const found = [];
  for (const block of blocksOf(lines, ext)) {
    const extent = physicalExtent(block, lines);
    const joined = block.map((comment) => comment.text).join(" ");
    const linked = /\bhttps?:\/\//.test(joined);
    for (const { line, text } of block) {
      const at = { from: line, to: line, cite: text.trim().slice(0, 100) };
      if (TODO_MARK.test(text) && !TODO_OWNED.test(text) && !ISSUE_LINK.test(text)) {
        found.push({
          ...at,
          rule: "todo",
          why: 'a TODO names its owner, area or issue, "TODO(name):" or "TODO(#1234):", or links the issue.',
        });
      }
      if (COPIED.test(text) && !linked) {
        found.push({
          ...at,
          rule: "source",
          warn: true,
          why: "copied or adapted code links the original source.",
        });
      }
      for (const [raw] of text.matchAll(URL_IN_TEXT)) {
        const problem = urlProblem(raw);
        if (problem)
          found.push({
            ...at,
            rule: "url",
            why: `${raw} ${problem}; link what every reader can open.`,
          });
      }
    }
    if (restatesCode(block, lines, extent, ext)) {
      found.push({
        from: extent.start,
        to: extent.end,
        cite: joined.trim().slice(0, 100),
        rule: "restates",
        warn: true,
        why: "restates the next line of code. Say why, or delete it and let the names speak.",
      });
    }
  }
  return found;
}

function extractComments(source, ext) {
  const lines = source.split("\n");
  return withBlockContext(scanFor(lines, ext), lines, ext);
}

// camelCase only: a case shift separates a name from an English word, and PascalCase or
// snake_case names are mostly types and fields from outside the repo.
function looksLikeSymbol(token) {
  if (!/^[a-z][A-Za-z0-9$]*$/.test(token)) return false;
  if (token.length < 4 || ALLOW.has(token)) return false;
  return /[a-z][A-Z]/.test(token);
}

// Everything one comment line claims about the repo. `context` is the whole paragraph; a negation
// is read only from `prefix`, what the paragraph said before the citation.
function findCitations(text, context = text, prefix = "") {
  const clean = text.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
  if (NAMES_ANOTHER_REPO.test(context) || NAMES_A_DEPENDENCY.test(context)) {
    return { paths: [], symbols: [], claims: [] };
  }
  const paths = [];
  const symbols = [];
  let outsideTicks = clean;
  for (const match of clean.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1].trim();
    const before = prefix + clean.slice(0, match.index);
    outsideTicks = outsideTicks.replace(match[0], " ".repeat(match[0].length));
    if (ASSERTS_ABSENCE.test(before)) continue;
    const withLine = span.match(new RegExp(`^(.+\\.${PATH_EXT}):(\\d+)$`));
    if (withLine) {
      paths.push({ path: withLine[1], line: Number(withLine[2]), quoted: span });
      continue;
    }
    if (PATHISH.test(span)) {
      paths.push({ path: span, line: null, quoted: span });
      continue;
    }
    if (looksLikeSymbol(span)) symbols.push(span);
  }
  for (const match of outsideTicks.matchAll(BARE_PATH_LINE)) {
    if (ASSERTS_ABSENCE.test(prefix + clean.slice(0, match.index))) continue;
    paths.push({ path: match[1], line: Number(match[2]), quoted: match[0] });
  }
  const claims = [...clean.matchAll(TEST_CLAIM)].map((m) => ({ phrase: m[1], path: m[2] }));
  return { paths, symbols, claims };
}

/** The repo as the checker needs to see it: which paths exist, how long they are, and where a
 *  word occurs. Backed by git, so it sees what is tracked and nothing else. */
export function openRepo(root) {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256e6,
  })
    .split("\n")
    .filter(Boolean);
  const files = new Set(tracked);
  const byBasename = new Map();
  for (const file of tracked) {
    const base = path.basename(file);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(file);
  }
  const contents = new Map();

  const read = (file) => {
    if (!contents.has(file)) contents.set(file, readFileSync(path.join(root, file), "utf8"));
    return contents.get(file);
  };

  return {
    has: (file) => files.has(file),
    source: read,
    // Tried from the repo root, the citing file, its package, then as a path suffix, because
    // people abbreviate a long path to the part that identifies it.
    resolve(cited, from) {
      const candidates = [
        path.normalize(cited),
        path.normalize(path.join(path.dirname(from), cited)),
      ];
      for (let dir = path.dirname(from); dir !== "." && dir !== "/"; dir = path.dirname(dir)) {
        if (files.has(path.join(dir, "package.json"))) {
          candidates.push(path.normalize(path.join(dir, cited)));
          break;
        }
      }
      for (const candidate of candidates) if (files.has(candidate)) return candidate;
      const suffix = `/${path.normalize(cited)}`;
      const loose = cited.includes("/")
        ? tracked.filter((file) => file.endsWith(suffix))
        : (byBasename.get(cited) ?? []);
      // Several packages share a basename, so the citing file's own package wins.
      return nearestTo(from, loose);
    },
    // A `packages/<name>/...` path whose package this checkout does not contain.
    namesAbsentPackage(cited) {
      const parts = path.normalize(cited).split("/");
      if (parts[0] !== "packages" || parts.length < 3) return false;
      return !tracked.some((file) => file.startsWith(`packages/${parts[1]}/`));
    },
    lineCount(file) {
      return read(file).split("\n").length;
    },
    mentions(file, token) {
      return read(file).includes(token);
    },
    // Where each token occurs as a whole word, as "path:line". One git grep per batch of 400,
    // since a spawn per token is minutes on a large diff.
    occurrencesOf(tokens) {
      const found = new Map(tokens.map((token) => [token, []]));
      for (let i = 0; i < tokens.length; i += 400) {
        const batch = tokens.slice(i, i + 400);
        let output = "";
        try {
          output = execFileSync("git", ["grep", "-nwF", ...batch.flatMap((t) => ["-e", t])], {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 512e6,
          });
        } catch (error) {
          // git grep exits 1 for "no matches at all". Any other status is a broken repo.
          if (error.status !== 1) throw error;
        }
        for (const hit of output.split("\n")) {
          if (!hit) continue;
          const at = hit.split(":").slice(0, 2).join(":");
          const body = hit.slice(at.length + 1);
          for (const token of batch) if (body.includes(token)) found.get(token).push(at);
        }
      }
      return found;
    },
  };
}

/** Every claim the comments in these files make about the rest of the repo, before any of it is
 *  resolved. Kept separate from resolution so the resolver can batch its one git grep. */
function collectCitations(files, repo, inScope) {
  const cited = [];
  // The one place that decides whether a named file was opened; the OK line reports this count.
  let examined = 0;
  for (const file of files) {
    if (!SCANNABLE.has(path.extname(file))) continue;
    if (!repo.has(file)) continue; // deleted by this diff, or untracked
    examined++;
    for (const comment of extractComments(repo.source(file), path.extname(file))) {
      const where = `${file}:${comment.line}`;
      const touched = inScope(file, comment.line);
      const { paths, symbols, claims } = findCitations(
        comment.text,
        comment.context,
        comment.prefix,
      );
      for (const cite of paths) cited.push({ kind: "path", where, file, touched, ...cite });
      for (const symbol of symbols) {
        cited.push({
          kind: "symbol",
          where,
          file,
          touched,
          symbol,
          blockStart: comment.blockStart,
          blockEnd: comment.blockEnd,
        });
      }
      for (const claim of claims)
        cited.push({ kind: "claim", where, file, touched, ...claim, symbols });
    }
  }
  return { cited, examined };
}

// `scope` is `{ kind: "all" }` for a sweep, or `{ kind: "lines", added, removed }` for a diff,
// where `removed` holds the names the diff's deleted code used. Only touched lines fail.
export function checkComments(root, files, scope = { kind: "all" }) {
  const repo = openRepo(root);
  const inScope = (file, line) =>
    scope.kind === "all" || (scope.added.get(file)?.has(line) ?? false);
  const touches = (file, start, end) => {
    const edited = scope.edited?.get(file);
    for (let line = start; line <= end; line++) {
      if (inScope(file, line) || edited?.has(line)) return true;
    }
    return false;
  };
  const { cited, examined } = collectCitations(files, repo, inScope);
  const warnings = [];
  const blockFailures = checkBlockRules(files, repo, touches);
  // Line rules grade the lines the diff added; the restating rule grades the block it rests on.
  for (const file of files.filter((name) => repo.has(name))) {
    for (const finding of practiceFindings(repo.source(file), path.extname(file))) {
      const graded =
        finding.rule === "restates"
          ? touches(file, finding.from, finding.to)
          : inScope(file, finding.from);
      if (!graded) continue;
      const entry = { where: `${file}:${finding.from}`, cite: finding.cite, why: finding.why };
      (finding.warn ? warnings : blockFailures).push(entry);
    }
  }
  const symbols = [...new Set(cited.filter((c) => c.kind === "symbol").map((c) => c.symbol))];
  const occurrences = repo.occurrencesOf(symbols);
  const missingPaths = new Set();
  const failures = [];
  const report = (cite, why) =>
    (cite.touched ? failures : warnings).push({
      where: cite.where,
      cite: cite.quoted ?? cite.display,
      why,
    });

  for (const cite of cited) {
    if (cite.kind === "path") {
      if (namesSomethingElse(cite.path) || repo.namesAbsentPackage(cite.path)) continue;
      const resolved = repo.resolve(cite.path, cite.file);
      if (resolved === null) {
        missingPaths.add(`${cite.where} ${cite.path}`);
        report(cite, "no such file in the repo");
        continue;
      }
      const length = repo.lineCount(resolved);
      if (cite.line !== null && cite.line > length)
        report(cite, `${resolved} has only ${length} lines`);
      continue;
    }

    if (cite.kind === "symbol") {
      // A hit inside the citing block proves nothing, so the whole block is excluded, not only
      // the citing line: a renamed symbol can linger two lines up in the same docblock.
      const elsewhere = occurrences.get(cite.symbol).filter((hit) => {
        const match = hit.match(/^(.*):(\d+)$/);
        if (!match) return true;
        const [, hitFile, hitLine] = match;
        return !(
          hitFile === cite.file &&
          Number(hitLine) >= cite.blockStart &&
          Number(hitLine) <= cite.blockEnd
        );
      });
      // A comment explaining a deletion may name what the diff's removed code used. Removed
      // code, not removed lines: an edited comment would otherwise waive its own stale name.
      if (elsewhere.length === 0 && !scope.removed?.has(cite.symbol)) {
        report(
          { ...cite, display: `\`${cite.symbol}\`` },
          "resolves nowhere in the repo (add it to ALLOW in this script if it names something outside it)",
        );
      }
      continue;
    }

    if (namesSomethingElse(cite.path) || repo.namesAbsentPackage(cite.path)) continue;
    const shown = { ...cite, display: `${cite.phrase} ${cite.path}` };
    const resolved = repo.resolve(cite.path, cite.file);
    if (resolved === null) {
      // The path pass owns "no such file"; report it here only if it did not already see this one.
      if (!missingPaths.has(`${cite.where} ${cite.path}`))
        report(shown, "that file does not exist");
      continue;
    }
    if (
      cite.symbols.length > 0 &&
      !cite.symbols.some((symbol) => repo.mentions(resolved, symbol))
    ) {
      report(
        shown,
        `${resolved} never mentions ${cite.symbols.map((sym) => `\`${sym}\``).join(" or ")}`,
      );
    }
  }
  return { failures: [...failures, ...blockFailures], warnings, examined };
}

function mergeBase(root, ref) {
  return execFileSync("git", ["merge-base", ref, "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function changedFiles(root, base) {
  return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64e6,
  })
    .split("\n")
    .filter(Boolean);
}

// The code on one removed line, comment stripped. It errs toward dropping names: a lost name
// fails a citation loudly, a kept one would waive it silently.
function codeOnly(line) {
  const closed = line.replace(/\/\*[\s\S]*?\*\//g, " ");
  const opensBlock = closed.indexOf("/*");
  const body = opensBlock === -1 ? closed : closed.slice(0, opensBlock);
  if (/^\s*\*/.test(body)) return "";
  const opensLine = body.indexOf("//");
  return opensLine === -1 ? body : body.slice(0, opensLine);
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

// One `git diff` answers three things: the lines each file gained, the lines a deleted comment line
// sat between (so the block it left still counts as edited), and the names removed code used.
// No pathspec: limiting it to the new paths stops git pairing a rename with its old path.
function diffScope(root, base) {
  const added = new Map();
  const edited = new Map();
  const removed = new Set();
  const diff = execFileSync("git", ["diff", "--unified=0", "-M", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256e6,
  });
  let lines = null;
  let near = null;
  let gapAt = null;
  let hashComments = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      lines = near = null;
      if (line.startsWith("+++ b/")) {
        hashComments = line.endsWith(".py");
        added.set(line.slice(6), (lines = new Set()));
        edited.set(line.slice(6), (near = new Set()));
      }
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/);
    if (hunk) {
      const start = Number(hunk[1]);
      const count = Number(hunk[2] ?? 1);
      for (let i = 0; i < count; i++) lines?.add(start + i);
      gapAt = count === 0 ? start : null;
      continue;
    }
    // Skips the "--- a/path" header, and with it a removed line whose code starts with a dash.
    if (line.startsWith("-") && !line.startsWith("---")) {
      const body = line.slice(1);
      const isComment = COMMENT_LINE.test(body) || (hashComments && HASH_COMMENT_LINE.test(body));
      if (near && gapAt !== null && isComment) near.add(gapAt).add(gapAt + 1);
      for (const name of codeOnly(body).match(IDENTIFIER) ?? []) removed.add(name);
    }
  }
  return { added, edited, removed };
}

// A file whose citations are dead by construction. Every run grades it first, resolved against
// this script's repo, so a checker that stopped resolving cannot print OK.
export const PROBE = "scripts/gate-probes/broken-citation.md";
const PROBE_ROOT = path.resolve(import.meta.dirname, "..");

// Path and symbol citations are settled by separate resolvers; each must report on the probe.
const PROBE_MUST_REPORT = [
  ["a path that does not resolve", /no such file|does not exist/],
  ["a symbol that resolves nowhere", /resolves nowhere/],
];

function proveGateCanFail() {
  let failures = [];
  try {
    failures = checkComments(PROBE_ROOT, [PROBE], { kind: "all" }).failures;
  } catch (error) {
    console.error(`comments: the self-check could not run: ${error.message}`);
    process.exit(2);
  }
  const silent = PROBE_MUST_REPORT.filter(
    ([, saying]) => !failures.some((f) => saying.test(f.why)),
  );
  if (silent.length === 0) return;
  console.error(`comments: SELF-CHECK FAILED. ${PROBE} carries a citation of each kind below and`);
  console.error(`  this checker did not report ${silent.length} of them, so a clean verdict on`);
  console.error(`  anything else would mean nothing. Silent:`);
  for (const [kind] of silent) console.error(`    ${kind}`);
  console.error(`  Repair the checker, or the probe file if it was edited.`);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  proveGateCanFail();
  const explicit = process.argv.slice(2);
  // Named files are a sweep of every line and need no git ref; no arguments grades the diff
  // against the fork point with the base branch.
  const base =
    explicit.length > 0 ? null : mergeBase(root, process.env.COMMENT_CHECK_BASE ?? "origin/main");
  // The probe is graded by the self-check only, or every PR that edits it would go red.
  const files =
    base === null ? explicit : changedFiles(root, base).filter((file) => file !== PROBE);
  const scope = base === null ? { kind: "all" } : { kind: "lines", ...diffScope(root, base) };
  const { failures, warnings, examined } = checkComments(root, files, scope);

  // A run that opened no file must not print OK. A sweep that examined nothing is a mistaken
  // invocation (a git ref passed as a path); a diff with no scannable file is ordinary.
  if (examined === 0) {
    if (explicit.length > 0) {
      console.error(`comments: examined 0 of the ${explicit.length} argument(s) given.`);
      console.error(`  This script takes FILE PATHS, not a git ref, and only these extensions:`);
      console.error(`  ${[...SCANNABLE].join(" ")}. Run it with no arguments to grade the diff.`);
      process.exit(2);
    }
    console.log(`comments: nothing to check (${files.length} changed file(s), none scannable)`);
    process.exit(0);
  }

  for (const warning of warnings) {
    console.log(`comments: ${warning.where}  ${warning.cite}\n    ${warning.why}`);
  }
  if (warnings.length > 0) {
    console.log(
      `\n  ${warnings.length} warning(s). They do not fail the build; fixing one while you are in`,
    );
    console.log(`  the file is still free.\n`);
  }
  if (failures.length === 0) {
    console.log(`comments: OK (${examined} file(s) examined of ${files.length} in scope)`);
    process.exit(0);
  }
  console.error(
    `comments FAILED. ${failures.length} problem(s) in the comments of the files this diff changed.\n`,
  );
  for (const failure of failures) {
    console.error(`  - ${failure.where}  ${failure.cite}`);
    console.error(`      ${failure.why}`);
  }
  console.error(
    `\n  Fix the citation or delete the comment. A comment nobody can trust is worse than`,
  );
  console.error(`  no comment: it reads as evidence and sends the next reader to a dead end.`);
  process.exit(1);
}

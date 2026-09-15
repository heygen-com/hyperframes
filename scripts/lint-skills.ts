/**
 * Lint SKILL.md files for patterns that break Claude Code's bash permission checker.
 *
 * Claude Code scans skill content for shell-like patterns. Inline backtick code
 * containing `!` (history expansion) or `>` (output redirection) outside of fenced
 * code blocks triggers false positives and prevents the skill from loading.
 *
 * Safe:  fenced code blocks (```...```), HTML tags in backticks (`<div>`)
 * Unsafe: `!` followed by `>` later in the same text block
 */

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { RegistryManifest } from "../packages/core/src/index.js";

const REPO_ROOT = join(import.meta.dirname, "..");
// Every location that ships SKILL.md files gets linted. `skills/` is the
// marketplace-distributed set; `.claude/skills/` and `.agents/skills/` are the
// repo-native project skills auto-discovered by Claude Code and Codex CLI.
const SKILLS_DIRS = [
  join(REPO_ROOT, "skills"),
  join(REPO_ROOT, ".claude", "skills"),
  join(REPO_ROOT, ".agents", "skills"),
];

interface Violation {
  file: string;
  line: number;
  message: string;
  text: string;
}

// Patterns that trigger Claude Code's bash permission checker when found in
// inline backtick spans (not fenced code blocks).
// - Backtick-wrapped `!` — interpreted as bash history expansion
// - Bare `>` outside fenced blocks when preceded by `!` — interpreted as redirection
const DANGEROUS_INLINE_PATTERNS: { pattern: RegExp; message: string }[] = [
  {
    // `!` in backticks triggers bash history expansion detection, which then
    // causes Claude Code to scan surrounding text for `>` (redirection).
    pattern: /`[^`]*![^`]*`/,
    message:
      'Inline backtick contains `!` — Claude Code interprets this as bash history expansion. Use the word instead (e.g., "exclamation").',
  },
  {
    // Bare `>` followed by a word char (e.g., `>file`, `>150ms`) looks like
    // output redirection. HTML tag closers (`<div>`, `</script>`) are fine
    // because `>` is followed by `<`, space, backtick, or end of string.
    pattern: /`[^`]*>\w[^`]*`/,
    message:
      'Inline backtick contains `>` followed by a word character — Claude Code may interpret this as output redirection. Rephrase (e.g., "150ms+" instead of ">150ms").',
  },
];

function collectSkillFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSkillFiles(full));
    } else if (entry.name === "SKILL.md") {
      files.push(full);
    }
  }
  return files;
}

/**
 * Flag YAML frontmatter that won't parse, which aborts `skills add` for the
 * WHOLE repo (one bad SKILL.md blocks installing every skill).
 *
 * ponytail: targets the one failure mode we've actually hit — an unquoted
 * top-level scalar whose value contains `: ` (colon-space), which YAML 1.2
 * reads as a nested mapping ("Nested mappings are not allowed in compact
 * mappings"). Not a full YAML parse; if a different malformation appears,
 * swap this for a real parser (the `yaml` package).
 */
// SKILL.md frontmatter schema.
//
// Two required top-level string keys plus three optional ones. Parsed with a
// real YAML parser (the `yaml` npm package) so we can validate value TYPES
// (name/description must be strings, allowed-tools must be a sequence or
// string, metadata must be a mapping), not just line-level patterns.
//
// This is a NECESSARY-but-not-SUFFICIENT gate. Catches:
//   * unsupported top-level keys (e.g. `category:`)
//   * missing name / description
//   * malformed YAML
//   * type errors (name is a list; description is a number; metadata is a scalar)
//   * empty string values
//
// The canonical Claude Code / Codex CLI / marketplace loaders may enforce
// stricter rules (name regex, description length, nested-schema shape); those
// are validated at load / install time. Positive + negative fixtures live in
// scripts/lint-skills.test.mjs.

const REQUIRED_FRONTMATTER_KEYS = new Set(["name", "description"]);
const OPTIONAL_FRONTMATTER_KEYS = new Set(["license", "allowed-tools", "metadata"]);
const KNOWN_FRONTMATTER_KEYS = new Set([
  ...REQUIRED_FRONTMATTER_KEYS,
  ...OPTIONAL_FRONTMATTER_KEYS,
]);

type LineViolation = Omit<Violation, "file">;

function violation(line: number, message: string, text: string): LineViolation {
  return { line, message, text };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseFrontmatterYaml(body: string): { data?: unknown; error?: string } {
  try {
    return { data: parseYaml(body) };
  } catch (err) {
    if (err instanceof YAMLParseError) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function typeLabel(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  return typeof v;
}

function missingRequired(data: Record<string, unknown>): LineViolation[] {
  return [...REQUIRED_FRONTMATTER_KEYS]
    .filter((k) => !(k in data))
    .map((k) => violation(-1, `Missing required frontmatter key "${k}".`, "<top of file>"));
}

function unsupportedKeys(data: Record<string, unknown>): LineViolation[] {
  return Object.keys(data)
    .filter((k) => !KNOWN_FRONTMATTER_KEYS.has(k))
    .map((k) =>
      violation(
        -1,
        `Unsupported frontmatter key "${k}" — SKILL.md accepts required { ` +
          `${[...REQUIRED_FRONTMATTER_KEYS].join(", ")} } plus optional { ` +
          `${[...OPTIONAL_FRONTMATTER_KEYS].join(", ")} }.`,
        `${k}: ...`,
      ),
    );
}

function stringFieldError(key: string, value: unknown, allowEmpty: boolean): LineViolation | null {
  if (typeof value !== "string") {
    return violation(
      -1,
      `Frontmatter "${key}" must be a string (got ${typeLabel(value)}).`,
      `${key}: ${JSON.stringify(value)}`,
    );
  }
  if (!allowEmpty && value.trim().length === 0) {
    return violation(-1, `Frontmatter "${key}" must not be empty.`, `${key}: ""`);
  }
  return null;
}

function validateStringField(
  data: Record<string, unknown>,
  key: string,
  allowEmpty: boolean,
): LineViolation | null {
  return key in data ? stringFieldError(key, data[key], allowEmpty) : null;
}

function isValidAllowedTools(value: unknown): boolean {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateAllowedTools(data: Record<string, unknown>): LineViolation | null {
  if (!("allowed-tools" in data)) return null;
  if (isValidAllowedTools(data["allowed-tools"])) return null;
  return violation(
    -1,
    `Frontmatter "allowed-tools" must be a string or a list of strings.`,
    `allowed-tools: ${JSON.stringify(data["allowed-tools"])}`,
  );
}

function validateMetadata(data: Record<string, unknown>): LineViolation | null {
  if (!("metadata" in data)) return null;
  if (isPlainObject(data.metadata)) return null;
  return violation(
    -1,
    `Frontmatter "metadata" must be a mapping / object.`,
    `metadata: ${JSON.stringify(data.metadata)}`,
  );
}

function validateShape(data: Record<string, unknown>): LineViolation[] {
  const fieldChecks = [
    validateStringField(data, "name", false),
    validateStringField(data, "description", false),
    validateStringField(data, "license", true),
    validateAllowedTools(data),
    validateMetadata(data),
  ].filter((v): v is LineViolation => v !== null);
  return [...missingRequired(data), ...unsupportedKeys(data), ...fieldChecks];
}

function parsedDataError(parsed: { data?: unknown; error?: string }): LineViolation | null {
  if (parsed.error) {
    return violation(1, `Malformed YAML frontmatter: ${parsed.error}`, "<frontmatter block>");
  }
  if (isPlainObject(parsed.data)) return null;
  return violation(
    1,
    `Frontmatter must be a YAML mapping at the top level (got ${typeLabel(parsed.data)}).`,
    "<frontmatter block>",
  );
}

export function lintFrontmatter(content: string): LineViolation[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return [
      violation(1, `Missing SKILL.md YAML frontmatter (must start with '---').`, "<top of file>"),
    ];
  }
  const parsed = parseFrontmatterYaml(match[1] ?? "");
  const preflightError = parsedDataError(parsed);
  if (preflightError) return [preflightError];
  return validateShape(parsed.data as Record<string, unknown>);
}

/** Strip fenced code blocks so we only lint prose + inline code. */
function stripFencedBlocks(content: string): string {
  return content.replace(/^```[\s\S]*?^```/gm, (match) =>
    match
      .split("\n")
      .map(() => "")
      .join("\n"),
  );
}

function matchDangerousPatterns(file: string, line: string, lineNumber: number): Violation[] {
  return DANGEROUS_INLINE_PATTERNS.filter((p) => p.pattern.test(line)).map((p) => ({
    file,
    line: lineNumber,
    message: p.message,
    text: line.trim(),
  }));
}

function lintInlinePatterns(file: string, stripped: string): Violation[] {
  return stripped
    .split("\n")
    .flatMap((line, i) => (line ? matchDangerousPatterns(file, line, i + 1) : []));
}

// ---------------------------------------------------------------------------
// Registry-item references in hand-maintained snapshots
// ---------------------------------------------------------------------------
//
// A skill doc that snapshots part of the component registry rots in silence:
// nothing fails when an item is renamed or dropped, and the agent that follows
// the doc runs `hyperframes add <gone>` and dies. A doc opts into this check
// with a marker line, after which every registry-item-shaped identifier in a
// backtick span must name a real item in registry/registry.json:
//
//   <!-- registry-items: allow=some-suffix,another-suffix -->
//
// Opt-in rather than repo-wide on purpose. Kebab-case backticks are also CSS
// properties, `data-*` attributes, skill directory names, script names, and
// motion-graphics category names, and a check that flags those is a check
// people turn off. `allow=` carries the few non-item identifiers a snapshot
// legitimately names (bare suffixes under a spelled-out prefix, ids the doc
// itself marks as hand-authored).
//
// TWO KNOWN BLIND SPOTS, both deliberate, both false NEGATIVES (this check
// never invents a violation, it only misses some):
//
//  1. Identifiers outside a backtick span are not seen. A bare `bar-chart-race`
//     in prose slipped past this check while it was a live defect elsewhere.
//  2. Single-word item names are not seen, because the pattern below requires a
//     hyphen. Measured on the six currently-marked files: dropping the hyphen
//     requirement would monitor 3 more real items (`glitch`, `flowchart`,
//     `typewriter`) and force 46 new allow= entries for ordinary prose words
//     ("add", "line", "name", "height", "text"). A 15:1 noise ratio is how a
//     check gets switched off, so the hyphen requirement stays.
const REGISTRY_MARKER = /<!--\s*registry-items:\s*(?:allow=([^\s]*))?\s*-->/;
// Shared by matchAll (registry rule) and replace (doc-ref rule); both leave
// lastIndex at 0. Never call .exec/.test on it — that would poison matchAll.
const INLINE_CODE_SPAN = /`([^`\n]+)`/g;
const REGISTRY_ITEM_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

function registryItemNames(): Set<string> {
  const raw = readFileSync(join(REPO_ROOT, "registry", "registry.json"), "utf-8");
  // The cast describes the file; it does not validate it. The runtime filter and
  // the throw below are what actually stop us linting against an empty set.
  const parsed = JSON.parse(raw) as RegistryManifest;
  const names = (parsed.items ?? []).map((item) => item.name).filter((name) => Boolean(name));
  if (names.length === 0) {
    throw new Error("registry/registry.json parsed to zero item names — refusing to lint blind.");
  }
  return new Set(names);
}

/** `null` when the file is not marked as a registry snapshot; otherwise its violations. */
export function lintRegistryItemRefs(content: string, known: Set<string>): LineViolation[] | null {
  // Marker detection ignores fenced blocks so a doc that *documents* the marker
  // syntax in an example does not arm the check on itself. The scan below still
  // reads full content, so ids inside fenced examples stay covered.
  const marker = stripFencedBlocks(content).match(REGISTRY_MARKER);
  if (!marker) return null;
  const allowed = new Set((marker[1] ?? "").split(",").filter(Boolean));
  return content.split("\n").flatMap((line, index) => {
    const dead = [...new Set([...line.matchAll(INLINE_CODE_SPAN)].map((m) => (m[1] ?? "").trim()))]
      .filter((token) => REGISTRY_ITEM_ID.test(token))
      .filter((token) => !known.has(token) && !allowed.has(token));
    return dead.map((token) =>
      violation(
        index + 1,
        `"${token}" is not an item in registry/registry.json, but this file is marked as a registry snapshot. Correct the name, remove it, or add it to the marker's allow= list if it is legitimately not an item.`,
        line.trim(),
      ),
    );
  });
}

// ---------------------------------------------------------------------------
// Cross-references between skill docs
// ---------------------------------------------------------------------------
//
// Skill docs point at each other with relative paths: `[text](../foo.md)`,
// `[id]: ../foo.md`, or a backticked `../foo.md` in prose. Nothing used to fail
// when such a path was wrong — typically `../` climbing one level too far from
// a `references/` or `sub-agents/` subdirectory, or a file that moved — and an
// agent following the doc hit a read error and improvised. This check resolves
// every checked target against the referencing file's own directory and
// requires it to exist. When the target carries a `#anchor` and is a Markdown
// file, the anchor must match a GitHub-style heading slug in that file
// (lowercase, punctuation stripped, spaces → `-`, duplicates suffixed `-1`,
// `-2`, …). Same-file `#anchor` links are checked against the file itself.
//
// Skipped on purpose: URLs with a scheme (`https:`, `mailto:`, …), absolute
// paths, anything inside a fenced code block, and template-ish targets that
// carry `{`, `}`, `*`, `$`, `<`, or `>` (`rules/<id>.md`).
//
// Markdown links and reference definitions have one resolution rule (relative
// to the file), so every relative target is checked. Backticked prose paths
// are checked only when they are explicitly relative (`./` or `../`) and point
// at a doc or example composition (`.md` / `.html`). A leading `./` or `../`
// is an unambiguous statement of "relative to this file", and a doc that uses
// it to mean "relative to the skill root" is exactly the defect this rule
// exists to catch. Bare backticked paths (`references/foo.md`) are NOT
// checked: measured on the current tree, most are skill-root shorthand, name a
// file in another skill, or describe a project artifact the skill writes at
// runtime (`assets/index.md`), and checking them would flag roughly 200 lines
// that are not wrong. That is a KNOWN false-negative blind spot, deliberately.

interface DocRef {
  line: number;
  target: string;
  text: string;
}

const INLINE_LINK = /\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
// CommonMark: `[id]: dest` optionally followed by a quoted title and nothing
// else, so a prose line like `[Label]: describes the thing` is not a definition.
const REFERENCE_DEFINITION =
  /^ {0,3}\[([^\]^][^\]]*)\]:\s*(<[^>\n]*>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)\n]*\)))?\s*$/;
const BACKTICK_RELATIVE_PATH = /`(\.\.?\/[^`\s]+\.(?:md|html)(?:#[^`\s]*)?)`/g;
const HAS_URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PLACEHOLDER_CHARS = /[{}*$<>]/;
const ATX_HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;

function unwrapTarget(raw: string): string {
  return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
}

function backtickTargets(line: string): string[] {
  return [...line.matchAll(BACKTICK_RELATIVE_PATH)].map((m) => m[1] ?? "");
}

function proseTargets(prose: string): string[] {
  const definition = REFERENCE_DEFINITION.exec(prose);
  const links = [...prose.matchAll(INLINE_LINK)].map((m) => unwrapTarget(m[1] ?? ""));
  return definition ? [unwrapTarget(definition[2] ?? ""), ...links] : links;
}

function docRefsInLine(line: string, lineNumber: number): DocRef[] {
  // Inline code is stripped before scanning for link syntax so a doc that
  // *documents* `[text](path)` is not read as linking to `path`.
  const prose = line.replace(INLINE_CODE_SPAN, "");
  // One violation per dead target per line: [`../x.md`](../x.md) names it twice.
  const targets = new Set([...backtickTargets(line), ...proseTargets(prose)]);
  const text = line.trim();
  return [...targets].map((target) => ({ line: lineNumber, target, text }));
}

function isCheckableTarget(target: string): boolean {
  return (
    target.length > 0 &&
    !HAS_URI_SCHEME.test(target) &&
    !target.startsWith("/") &&
    !PLACEHOLDER_CHARS.test(target)
  );
}

function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function dedupedSlug(seen: Map<string, number>, base: string): string {
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** GitHub-style anchor slugs for every ATX heading outside fenced blocks. */
export function headingSlugs(content: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  for (const line of stripFencedBlocks(content).split("\n")) {
    const heading = ATX_HEADING.exec(line);
    if (heading) slugs.add(dedupedSlug(seen, slugify(heading[1] ?? "")));
  }
  return slugs;
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function anchorViolation(
  ref: DocRef,
  anchor: string,
  targetLabel: string,
  targetContent: string,
): LineViolation | null {
  if (headingSlugs(targetContent).has(decodeTarget(anchor).toLowerCase())) return null;
  return violation(
    ref.line,
    `Anchor "#${anchor}" does not match any heading in ${targetLabel}.`,
    ref.text,
  );
}

function splitAnchor(target: string): { path: string; anchor: string | null } {
  const hash = target.indexOf("#");
  // A bare trailing `#` links to the top of the target, not to a heading.
  if (hash === -1 || hash === target.length - 1) {
    return { path: target.replace(/#$/, ""), anchor: null };
  }
  return { path: target.slice(0, hash), anchor: target.slice(hash + 1) };
}

type TargetRead = { kind: "missing" } | { kind: "directory" } | { kind: "file"; content: string };

const MISSING_TARGET_CODES = new Set(["ENOENT", "ENOTDIR"]);

function classifyReadError(err: unknown): TargetRead {
  const code = (err as NodeJS.ErrnoException).code ?? "";
  if (MISSING_TARGET_CODES.has(code)) return { kind: "missing" };
  if (code === "EISDIR") return { kind: "directory" };
  throw err;
}

// Read-and-classify in one syscall rather than stat-then-read, so the answer
// cannot change between the check and the read.
function readTarget(resolved: string): TargetRead {
  try {
    return { kind: "file", content: readFileSync(resolved, "utf-8") };
  } catch (err) {
    return classifyReadError(err);
  }
}

function missingViolation(ref: DocRef, label: string): LineViolation {
  return violation(
    ref.line,
    `Cross-reference "${ref.target}" does not resolve: ${label} does not exist.`,
    ref.text,
  );
}

function anchoredTargetViolation(
  ref: DocRef,
  anchor: string,
  resolved: string,
  label: string,
): LineViolation | null {
  const target = readTarget(resolved);
  if (target.kind === "missing") return missingViolation(ref, label);
  // A directory has no headings; existence is all that can be checked.
  if (target.kind === "directory") return null;
  return anchorViolation(ref, anchor, label, target.content);
}

function checkTargetPath(
  ref: DocRef,
  resolved: string,
  anchor: string | null,
): LineViolation | null {
  const label = relative(REPO_ROOT, resolved);
  // Only Markdown targets have heading slugs; an `.html#id` fragment is not checked.
  if (anchor === null || !resolved.endsWith(".md")) {
    return statSync(resolved, { throwIfNoEntry: false }) ? null : missingViolation(ref, label);
  }
  return anchoredTargetViolation(ref, anchor, resolved, label);
}

function checkDocRef(ref: DocRef, filePath: string, content: string): LineViolation | null {
  const { path, anchor } = splitAnchor(ref.target);
  if (path.length === 0) {
    return anchor === null ? null : anchorViolation(ref, anchor, "this file", content);
  }
  return checkTargetPath(ref, resolve(dirname(filePath), decodeTarget(path)), anchor);
}

/** Violations for relative cross-references in `content` (located at `filePath`) that do not resolve. */
export function lintDocRefs(filePath: string, content: string): LineViolation[] {
  return stripFencedBlocks(content)
    .split("\n")
    .flatMap((line, index) => docRefsInLine(line, index + 1))
    .filter((ref) => isCheckableTarget(ref.target))
    .flatMap((ref) => checkDocRef(ref, filePath, content) ?? []);
}

function collectMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function lintFile(filePath: string): Violation[] {
  const raw = readFileSync(filePath, "utf-8");
  const file = relative(process.cwd(), filePath);
  return [
    ...lintFrontmatter(raw).map((v) => ({ ...v, file })),
    ...lintInlinePatterns(file, stripFencedBlocks(raw)),
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Reporter {
  report: (file: string, violations: LineViolation[]) => void;
  total: () => number;
}

function createReporter(): Reporter {
  let total = 0;
  return {
    report(file, violations) {
      for (const v of violations) {
        console.error(`${file}:${v.line}: ${v.message}`);
        console.error(`  ${v.text}\n`);
        total++;
      }
    },
    total: () => total,
  };
}

/** Doc cross-references and registry snapshots for every markdown file; returns the snapshot count. */
function lintMarkdownFiles(paths: string[], knownItems: Set<string>, reporter: Reporter): number {
  let snapshotsChecked = 0;
  for (const path of paths) {
    const content = readFileSync(path, "utf-8");
    const file = relative(process.cwd(), path);
    reporter.report(file, lintDocRefs(path, content));
    const found = lintRegistryItemRefs(content, knownItems);
    if (found === null) continue;
    snapshotsChecked++;
    reporter.report(file, found);
  }
  return snapshotsChecked;
}

function main(): void {
  const skillsDirs = SKILLS_DIRS.filter((dir) =>
    statSync(dir, { throwIfNoEntry: false })?.isDirectory(),
  );
  const files = skillsDirs.flatMap(collectSkillFiles);
  if (files.length === 0) {
    console.log("No SKILL.md files found across skills/, .claude/skills/, .agents/skills/.");
    process.exit(0);
  }

  const reporter = createReporter();
  for (const file of files) {
    reporter.report(relative(process.cwd(), file), lintFile(file));
  }

  const knownItems = registryItemNames();
  const markdownFiles = skillsDirs.flatMap(collectMarkdownFiles);
  const snapshotsChecked = lintMarkdownFiles(markdownFiles, knownItems, reporter);

  if (reporter.total() > 0) {
    console.error(`\n${reporter.total()} skill lint error(s) found.`);
    process.exit(1);
  }
  console.log(
    `Checked ${files.length} skill file(s), cross-references in ${markdownFiles.length} markdown file(s), and ${snapshotsChecked} registry snapshot(s) against ${knownItems.size} registry items — no issues found.`,
  );
}

// Only run when executed directly (`tsx scripts/lint-skills.ts`). The test file
// imports the exported checkers, and a red tree must not exit the test runner.
// argv[1] is realpath'd because the ESM loader realpaths import.meta.url; without
// it a symlinked checkout (macOS /tmp) would skip main() and exit 0 silently.
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}

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
import { basename, dirname, join, relative, resolve } from "node:path";
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

// Cross-references between skill docs: relative link targets, and backticked `./` or `../` .md/.html paths, must
// resolve from the referencing file; `#anchor`s into .md files must match a GitHub heading slug. Bare paths like
// `references/<name>.md` are skill-root shorthand, checked by lintSkillPaths below.

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
  // One violation per dead target per line: a link whose text is the backticked target names it twice.
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

// ---------------------------------------------------------------------------
// Skill-root paths and skill names
// ---------------------------------------------------------------------------
//
// The cross-reference rule above leaves bare paths alone, and bare paths are how
// skills actually point at their own files: `references/bgm.md`,
// `<SKILL_DIR>/scripts/carve.mjs`, `hyperframes-core/references/sub-compositions.md`. When one of
// those goes stale the agent gets a read error mid-task (heygen-com/hyperframes#5025
// lists a batch). This rule checks every path-shaped token, in prose and in fenced
// blocks alike, whose first segment says it lives inside a skill:
//
//   <SKILL_DIR>/rest      rest must exist under the referencing skill's root
//   <NAME_SKILL_DIR>/rest rest must exist under skill `name` (`<HYPERFRAMES_AUDIO_SKILL_DIR>`
//                         is hyperframes-audio)
//   <skill-name>/rest     rest must exist under that skill's root
//   skills/<name>/rest    <name> must be a skill; in the distributed skills/ set it is
//                         flagged anyway, because it never resolves once a skill is
//                         installed (repo-native skills run in the repo)
//   <content-dir>/rest    a directory some skill ships (references/, scripts/, ...):
//                         rest must exist under the referencing skill, under any
//                         directory between it and the referencing file, or under a
//                         skill the same paragraph names as `/name` or `name`
//
// and every backticked `/name` that names a skill must name one that exists. A skill
// name resolves in the referencing skill's own tree first (`.claude/skills` and
// `.agents/skills` mirror each other), then in the distributed set.
//
// Anything else (project paths like `compositions/`, `.hyperframes/`, package
// paths, URLs, `./` and `../` paths, which the rule above owns) is not this rule's
// business. Paths containing placeholders (`<id>`, `{slug}`, `*`, `$VAR`) are skipped,
// as are extensionless paths without a trailing slash, which are too often ids or
// npm-style names to be read as files.
//
// A doc that names paths or skills on purpose that do not resolve from an installed
// skill (a shared file spliced into each workflow's own copy, a contributor guide
// naming repo scripts, an upstream skill) lists them in one or more marker lines:
//
//   <!-- skill-paths: allow=scripts/frame-packets.mjs,references/cut-catalog.md,/upstream-skill -->

export interface SkillIndex {
  /** Skills tree (the directory holding skill roots) → skill name → root directory. */
  trees: Map<string, Map<string, string>>;
  /** Names of the top-level directories any skill ships. */
  contentDirs: Set<string>;
  /** The set users install; repo-native skills elsewhere may name repo paths. */
  distributedDir: string;
}

// Skills that live outside this repo but are legitimately referenced by `/name`.
const EXTERNAL_SKILLS = new Set(["animate-text"]);
// Skill directories whose names are also the conventional project directory, so a
// bare `assets/logo.png` is far more often the user's project than the skill's.
const PROJECT_DIR_NAMES = new Set(["assets"]);
const SKILL_DIR_SEGMENT = /^(?:<SKILL_DIR>|\$\{?SKILL_DIR\}?)$/;
const NAMED_SKILL_DIR_SEGMENT = /^<([A-Z][A-Z0-9_]*)_SKILL_DIR>$/;
const PATH_TOKEN = /[\w.@<>${}*-]*\/[\w.@<>${}*/-]*/g;
const PATH_PLACEHOLDER = /[<>{}*$]/;
const SLASH_SKILL_REF = /`\/([a-z][a-z0-9-]*)`/g;
// `/name` anywhere, or a whole backticked `name`; a bare word that happens to equal a
// skill name ("the hyperframes CLI") is not a mention.
const SKILL_MENTION = /`\/?([a-z][a-z0-9-]*)`|(?:^|[^\w/-])\/([a-z][a-z0-9-]*)/g;
const SKILL_PATHS_MARKER = /<!--\s*skill-paths:\s*allow=([^\s]*)\s*-->/g;

export function buildSkillIndex(
  skillFiles: string[],
  distributedDir = join(REPO_ROOT, "skills"),
): SkillIndex {
  const trees = new Map<string, Map<string, string>>();
  const contentDirs = new Set<string>();
  for (const file of skillFiles) {
    const root = dirname(file);
    const tree = trees.get(dirname(root)) ?? new Map<string, string>();
    tree.set(basename(root), root);
    trees.set(dirname(root), tree);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !PROJECT_DIR_NAMES.has(entry.name)) contentDirs.add(entry.name);
    }
  }
  return { trees, contentDirs, distributedDir };
}

function skillRootOf(filePath: string, index: SkillIndex): string | null {
  let best: string | null = null;
  for (const tree of index.trees.values()) {
    for (const root of tree.values()) {
      const inside = filePath.startsWith(root + "/");
      if (inside && (best === null || root.length > best.length)) best = root;
    }
  }
  return best;
}

/** The root of skill `name` as seen from `ownRoot`: its own tree first, then the distributed set. */
function rootNamed(name: string, ownRoot: string, index: SkillIndex): string | undefined {
  return (
    index.trees.get(dirname(ownRoot))?.get(name) ?? index.trees.get(index.distributedDir)?.get(name)
  );
}

function skillsMentionedIn(paragraph: string, ownRoot: string, index: SkillIndex): string[] {
  const roots = [...paragraph.matchAll(SKILL_MENTION)]
    .map((m) => rootNamed(m[1] ?? m[2] ?? "", ownRoot, index))
    .filter((root): root is string => root !== undefined);
  return [...new Set(roots)];
}

/** For each line, the skill roots its paragraph (run of non-blank lines) mentions. */
function paragraphMentionsByLine(lines: string[], ownRoot: string, index: SkillIndex): string[][] {
  const out: string[][] = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && (lines[i] ?? "").trim() !== "") continue;
    const mentioned = skillsMentionedIn(lines.slice(start, i).join("\n"), ownRoot, index);
    for (let j = start; j <= i && j < lines.length; j++) out[j] = mentioned;
    start = i + 1;
  }
  return out;
}

/** The referencing file's directory and each of its ancestors up to the skill root. */
function dirsUpToRoot(filePath: string, ownRoot: string): string[] {
  const dirs: string[] = [];
  for (let dir = dirname(filePath); dir.startsWith(ownRoot); dir = dirname(dir)) dirs.push(dir);
  return dirs;
}

function cleanPathToken(raw: string): string {
  return raw.replace(/[.]+$/, "");
}

function isFileOrDirShaped(rest: string[]): boolean {
  const last = rest[rest.length - 1] ?? "";
  return last === "" || /\.[A-Za-z0-9]+$/.test(last);
}

type PathCandidate =
  | { kind: "resolve"; bases: string[]; rest: string }
  | { kind: "nonPortable" }
  | { kind: "unknownSkill"; name: string };

interface PathContext {
  filePath: string;
  ownRoot: string;
  mentioned: string[];
  index: SkillIndex;
}

function skillCandidate(name: string, rest: string, ctx: PathContext): PathCandidate {
  const root = rootNamed(name, ctx.ownRoot, ctx.index);
  return root === undefined
    ? { kind: "unknownSkill", name }
    : { kind: "resolve", bases: [root], rest };
}

function classifyPath(token: string, ctx: PathContext): PathCandidate | null {
  const segments = token.split("/");
  const [first = "", ...rest] = segments;
  if (rest.length === 0 || first === "" || first.startsWith(".")) return null;
  if (SKILL_DIR_SEGMENT.test(first))
    return { kind: "resolve", bases: [ctx.ownRoot], rest: rest.join("/") };
  const named = NAMED_SKILL_DIR_SEGMENT.exec(first);
  if (named)
    return skillCandidate((named[1] ?? "").toLowerCase().replace(/_/g, "-"), rest.join("/"), ctx);
  if (first === "skills") {
    const [name = "", ...inner] = rest;
    if (inner.length === 0 || PATH_PLACEHOLDER.test(name)) return null;
    if (ctx.ownRoot.startsWith(ctx.index.distributedDir + "/")) return { kind: "nonPortable" };
    return skillCandidate(name, inner.join("/"), ctx);
  }
  if (rootNamed(first, ctx.ownRoot, ctx.index) !== undefined)
    return skillCandidate(first, rest.join("/"), ctx);
  if (!ctx.index.contentDirs.has(first)) return null;
  const bases = [...dirsUpToRoot(ctx.filePath, ctx.ownRoot), ...ctx.mentioned];
  return { kind: "resolve", bases: [...new Set(bases)], rest: segments.join("/") };
}

function pathViolation(
  token: string,
  candidate: PathCandidate,
  lineNumber: number,
  text: string,
): LineViolation | null {
  if (candidate.kind === "nonPortable") {
    return violation(
      lineNumber,
      `"${token}" only resolves from the repo root, not from an installed skill. Use <SKILL_DIR>/... for this skill's own files, or name the other skill (\`/name\`) and its skill-relative path.`,
      text,
    );
  }
  if (candidate.kind === "unknownSkill") {
    return violation(
      lineNumber,
      `"${token}" names "${candidate.name}", which is not a skill in this repo.`,
      text,
    );
  }
  const rest = candidate.rest.split("/");
  if (rest.some((s) => PATH_PLACEHOLDER.test(s)) || !isFileOrDirShaped(rest)) return null;
  const found = candidate.bases.some((base) =>
    statSync(join(base, candidate.rest), { throwIfNoEntry: false }),
  );
  if (found) return null;
  const looked = candidate.bases.map((b) => relative(REPO_ROOT, b) || ".").join(", ");
  return violation(
    lineNumber,
    `Skill path "${token}" does not resolve (looked under: ${looked}).`,
    text,
  );
}

function skillNameViolations(
  line: string,
  lineNumber: number,
  ownRoot: string,
  index: SkillIndex,
  allowed: Set<string>,
): LineViolation[] {
  return (
    [...new Set([...line.matchAll(SLASH_SKILL_REF)].map((m) => m[1] ?? ""))]
      // A hyphenless `/word` is as often arithmetic (`/fps`) or a caption as a skill.
      .filter((name) => name.includes("-") && rootNamed(name, ownRoot, index) === undefined)
      .filter((name) => !EXTERNAL_SKILLS.has(name) && !allowed.has(`/${name}`))
      .map((name) => violation(lineNumber, `"/${name}" is not a skill in this repo.`, line.trim()))
  );
}

function allowedTokens(content: string): Set<string> {
  const lists = [...content.matchAll(SKILL_PATHS_MARKER)].map((m) => m[1] ?? "");
  return new Set(lists.flatMap((list) => list.split(",")).filter(Boolean));
}

/** Violations for skill-root paths and `/skill` names in `content` (located at `filePath`) that do not resolve. */
export function lintSkillPaths(
  filePath: string,
  content: string,
  index: SkillIndex,
): LineViolation[] {
  const ownRoot = skillRootOf(filePath, index);
  if (ownRoot === null) return [];
  const allowed = allowedTokens(content);
  const lines = content.split("\n");
  const mentions = paragraphMentionsByLine(lines, ownRoot, index);
  return lines.flatMap((line, i) => {
    const text = line.trim();
    const ctx: PathContext = { filePath, ownRoot, mentioned: mentions[i] ?? [], index };
    const tokens = new Set([...line.matchAll(PATH_TOKEN)].map((m) => cleanPathToken(m[0])));
    const paths = [...tokens]
      .filter((token) => !allowed.has(token))
      .flatMap((token) => {
        const candidate = classifyPath(token, ctx);
        return candidate ? (pathViolation(token, candidate, i + 1, text) ?? []) : [];
      });
    return [...paths, ...skillNameViolations(line, i + 1, ownRoot, index, allowed)];
  });
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

type Report = (file: string, violations: LineViolation[]) => void;

/** Doc cross-references and registry snapshots for every markdown file; returns the snapshot count. */
function lintMarkdownFiles(
  paths: string[],
  knownItems: Set<string>,
  skills: SkillIndex,
  report: Report,
): number {
  let snapshotsChecked = 0;
  for (const path of paths) {
    const content = readFileSync(path, "utf-8");
    const file = relative(process.cwd(), path);
    report(file, lintDocRefs(path, content));
    report(file, lintSkillPaths(path, content, skills));
    const found = lintRegistryItemRefs(content, knownItems);
    if (found === null) continue;
    snapshotsChecked++;
    report(file, found);
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

  let totalViolations = 0;
  const report: Report = (file, violations) => {
    for (const v of violations) {
      console.error(`${file}:${v.line}: ${v.message}`);
      console.error(`  ${v.text}\n`);
    }
    totalViolations += violations.length;
  };

  for (const file of files) {
    report(relative(process.cwd(), file), lintFile(file));
  }

  const knownItems = registryItemNames();
  const markdownFiles = skillsDirs.flatMap(collectMarkdownFiles);
  const skills = buildSkillIndex(files);
  const snapshotsChecked = lintMarkdownFiles(markdownFiles, knownItems, skills, report);

  if (totalViolations > 0) {
    console.error(`\n${totalViolations} skill lint error(s) found.`);
    process.exit(1);
  }
  console.log(
    `Checked ${files.length} skill file(s), cross-references in ${markdownFiles.length} markdown file(s), and ${snapshotsChecked} registry snapshot(s) against ${knownItems.size} registry items — no issues found.`,
  );
}

// Tests import the checkers, so main() runs only as the entry point. argv[1] is realpath'd to match import.meta.url,
// which the ESM loader realpaths; otherwise a symlinked checkout would skip main() and exit 0.
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

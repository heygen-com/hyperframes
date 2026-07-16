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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";

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
  const parsed = parseFrontmatterYaml(match[1]);
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

const files: string[] = [];
for (const dir of SKILLS_DIRS) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
  files.push(...collectSkillFiles(dir));
}
if (files.length === 0) {
  console.log("No SKILL.md files found across skills/, .claude/skills/, .agents/skills/.");
  process.exit(0);
}

let totalViolations = 0;

for (const file of files) {
  const violations = lintFile(file);
  for (const v of violations) {
    console.error(`${v.file}:${v.line}: ${v.message}`);
    console.error(`  ${v.text}\n`);
    totalViolations++;
  }
}

if (totalViolations > 0) {
  console.error(`\n${totalViolations} skill lint error(s) found.`);
  process.exit(1);
} else {
  console.log(`Checked ${files.length} skill file(s) — no issues found.`);
}

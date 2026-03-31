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

const SKILLS_DIR = join(import.meta.dirname, "..", "skills");

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

/** Strip fenced code blocks so we only lint prose + inline code. */
function stripFencedBlocks(content: string): string {
  return content.replace(/^```[\s\S]*?^```/gm, (match) =>
    match
      .split("\n")
      .map(() => "")
      .join("\n"),
  );
}

function lintFile(filePath: string): Violation[] {
  const raw = readFileSync(filePath, "utf-8");
  const stripped = stripFencedBlocks(raw);
  const lines = stripped.split("\n");
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const { pattern, message } of DANGEROUS_INLINE_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: relative(process.cwd(), filePath),
          line: i + 1,
          message,
          text: line.trim(),
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!statSync(SKILLS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
  console.log("No skills/ directory found — skipping skill lint.");
  process.exit(0);
}

const files = collectSkillFiles(SKILLS_DIR);
if (files.length === 0) {
  console.log("No SKILL.md files found.");
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

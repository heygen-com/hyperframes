#!/usr/bin/env node
/**
 * Heuristic scanner for hardcoded English strings in Studio TSX files.
 * Reports file:line:text — informational only (always exits 0).
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");

const SKIP_DIRS = new Set(["i18n", "__tests__"]);
const CHECK_ATTRS = ["aria-label", "title", "placeholder"];

const ATTR_PATTERN = new RegExp(`(?:${CHECK_ATTRS.join("|")})=(["'])([^"'{][^"']*)\\1`, "g");
const JSX_TEXT_PATTERN = />([^<>{}]+)</g;
const JSX_STRING_PATTERN = /(?<![\w.])["']([A-Za-z][^"'\\]{1,})["']/g;

function looksLikeEnglish(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;

  // Skip identifiers, paths, and technical tokens without spaces.
  if (!/\s/.test(trimmed) && /^[\w./:@#%+\-]+$/.test(trimmed)) {
    if (trimmed.length <= 6 || /^[a-z][\w-]*$/.test(trimmed)) return false;
  }

  // Skip units, numbers, and punctuation-only fragments.
  if (/^[\d\s%px°×\-+.,:;!?()[\]{}]+$/.test(trimmed)) return false;

  return true;
}

function shouldSkipLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  if (/^\s*import\s/.test(line)) return true;
  if (/\bt\s*\(/.test(line) || /<Trans[\s>]/.test(line)) return true;
  if (/className=|data-testid=|data-hyperframes|viewBox=|xmlns=|strokeWidth=/.test(line)) {
    const hasCheckedAttr = CHECK_ATTRS.some((attr) => line.includes(`${attr}=`));
    if (!hasCheckedAttr && !/>[^<{]+</.test(line)) return true;
  }
  return false;
}

function isInsideTCall(line, index) {
  const before = line.slice(0, index);
  return /\bt\s*\([^)]*$/.test(before);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await walk(full)));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

function scanFile(content, filePath) {
  const findings = [];
  const lines = content.split("\n");
  const relPath = relative(ROOT, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (shouldSkipLine(line)) continue;

    for (const match of line.matchAll(ATTR_PATTERN)) {
      const text = match[2];
      if (looksLikeEnglish(text)) {
        findings.push({ file: relPath, line: lineNum, text, kind: match[0].split("=")[0] });
      }
    }

    for (const match of line.matchAll(JSX_TEXT_PATTERN)) {
      const text = match[1].trim();
      if (!text || text.startsWith("{")) continue;
      if (looksLikeEnglish(text)) {
        findings.push({ file: relPath, line: lineNum, text, kind: "jsx-text" });
      }
    }

    for (const match of line.matchAll(JSX_STRING_PATTERN)) {
      if (isInsideTCall(line, match.index ?? 0)) continue;
      const text = match[1];
      if (looksLikeEnglish(text)) {
        const alreadyFound = findings.some((f) => f.line === lineNum && f.text === text);
        if (!alreadyFound) {
          findings.push({ file: relPath, line: lineNum, text, kind: "string-literal" });
        }
      }
    }
  }

  return findings;
}

async function main() {
  const files = await walk(SRC_DIR);
  const allFindings = [];

  for (const file of files.sort()) {
    const content = await readFile(file, "utf8");
    allFindings.push(...scanFile(content, file));
  }

  if (allFindings.length === 0) {
    console.log("No likely hardcoded English strings found.");
    return;
  }

  console.log(
    `Found ${allFindings.length} likely hardcoded English string(s) in ${files.length} TSX file(s):\n`,
  );

  for (const finding of allFindings) {
    console.log(`${finding.file}:${finding.line}:${finding.text}`);
  }

  console.log(
    `\nNote: heuristic scan — may include false positives. Wrap user-facing copy in t("…") or pass translated props.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
// A link to a missing or mis-cased file silently breaks installed agent skills.
// Check Markdown links that resolve inside the published skills/ tree on every OS.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");
const MARKDOWN_LINK = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']+["'])?\)/g;

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) yield path;
  }
}

function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Filesystems such as NTFS may accept casing that fails on Linux.
export function existsWithExactCase(root, path) {
  if (!isWithin(root, path)) return false;
  let dir = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return false; // A path component is not a directory (or is unreadable).
    }
    if (!entries.includes(part)) return false;
    dir = join(dir, part);
  }
  return existsSync(dir); // Dangling symlinks are not valid link targets.
}

function localTarget(raw) {
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#|\?|\$|<)/i.test(raw)) return null;
  const pathname = raw.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname; // Report the invalid target if it points inside skills/.
  }
}

export function checkPublishedSkillLinks(root = SKILLS_ROOT) {
  const problems = [];
  for (const file of markdownFiles(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let fence = null;
    for (const [index, line] of lines.entries()) {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (fence === null) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        continue;
      }
      if (fence !== null) continue;
      for (const match of line.matchAll(MARKDOWN_LINK)) {
        const target = localTarget(match[1] ?? match[2]);
        if (target === null) continue;
        const resolved = resolve(dirname(file), target);
        // Repo-relative author links are not part of the installed skill bundle.
        if (!isWithin(root, resolved)) continue;
        if (!existsWithExactCase(root, resolved)) {
          problems.push(
            `${relative(root, file).split(sep).join("/")}:${index + 1}: missing or mis-cased local link ${target}`,
          );
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkPublishedSkillLinks();
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log("Published skill Markdown links resolve with exact casing.");
}

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createProjectSignature } from "./projectSignature.js";
import { rootHeadContent } from "./subComposition.js";
import { resolveWithinProject } from "./safePath.js";

const ROOT_COMPOSITION = "index.html";
// A regex, not a parser: a stray match (say, inside a script string) only widens what a
// change invalidates, never narrows it.
const COMPOSITION_SRC = /\bdata-composition-src\s*=\s*(["'])(.*?)\1/g;

type SourceReader = (compPath: string) => string | null;

function projectReader(projectDir: string): SourceReader {
  const sources = new Map<string, string | null>();
  return (compPath) => {
    if (!sources.has(compPath)) {
      const file = resolveWithinProject(projectDir, compPath);
      let source: string | null = null;
      try {
        source = file ? readFileSync(file, "utf-8") : null;
      } catch {
        // Missing or unreadable: it mounts nothing, and still counts as mounted by its host.
      }
      sources.set(compPath, source);
    }
    return sources.get(compPath) ?? null;
  };
}

function normalizeSource(src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return null;
  const path = src.split(/[?#]/)[0]?.replace(/^\.?\//, "") ?? "";
  return path || null;
}

/** `compPath` plus every composition it mounts, transitively, resolved from the project root as the bundler does. */
function closureOf(read: SourceReader, compPath: string): Set<string> {
  const closure = new Set<string>();
  const visit = (path: string) => {
    if (closure.has(path)) return;
    closure.add(path);
    for (const match of (read(path) ?? "").matchAll(COMPOSITION_SRC)) {
      const mounted = normalizeSource(match[2] ?? "");
      if (mounted) visit(mounted);
    }
  };
  visit(compPath);
  return closure;
}

// ponytail: this and projectSignature's per-exclusion cache keep one small entry per (project,
// composition) ever thumbnailed, never evicted; LRU them if a server ever holds thousands.
const inputSignatures = new Map<string, { projectSignature: string; inputSignature: string }>();

interface RootMemo {
  root: string;
  head: string;
  affected: string[] | null;
}

const rootMemos = new Map<string, RootMemo>();

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

function rootHashes(read: SourceReader) {
  const source = read(ROOT_COMPOSITION) ?? "";
  return { root: sha1(source), head: sha1(rootHeadContent(source)) };
}

// What a thumbnail of `compPath` renders from: the project minus the compositions the root
// mounts that `compPath` does not; for a scene the root counts as its head alone.
export function compositionInputSignature(
  projectDir: string,
  compPath: string,
  projectSignature: string,
): string {
  const key = `${projectDir}\0${compPath}`;
  const known = inputSignatures.get(key);
  if (known?.projectSignature === projectSignature) return known.inputSignature;
  const read = projectReader(projectDir);
  const comp = normalizeSource(compPath) ?? compPath;
  const inputs = closureOf(read, comp).add(ROOT_COMPOSITION);
  const excluded = new Set(
    [...closureOf(read, ROOT_COMPOSITION)].filter((path) => !inputs.has(path)),
  );
  let inputSignature: string;
  if (comp === ROOT_COMPOSITION) {
    inputSignature = createProjectSignature(projectDir, excluded);
  } else {
    const hashes = rootHashes(read);
    if (!rootMemos.has(projectDir)) rootMemos.set(projectDir, { ...hashes, affected: null });
    inputSignature = `${createProjectSignature(projectDir, excluded.add(ROOT_COMPOSITION))}:${hashes.head}`;
  }
  inputSignatures.set(key, { projectSignature, inputSignature });
  return inputSignature;
}

/**
 * Compositions whose rendered frames a write at `changedPath` can change, or `null` for all
 * of them: assets, a root head edit, and any file the root does not mount reach every
 * composition. A head-preserving root write changes only the root's own frames.
 */
export function compositionsAffectedBy(projectDir: string, changedPath: string): string[] | null {
  const changed = changedPath.replace(/\\/g, "/");
  const read = projectReader(projectDir);
  if (changed === ROOT_COMPOSITION) {
    const now = rootHashes(read);
    const memo = rootMemos.get(projectDir);
    if (memo?.root === now.root) return memo.affected;
    const affected = memo?.head === now.head ? [ROOT_COMPOSITION] : null;
    rootMemos.set(projectDir, { ...now, affected });
    return affected;
  }
  const mounted = closureOf(read, ROOT_COMPOSITION);
  if (!mounted.has(changed)) return null;
  return [...mounted].filter((path) => closureOf(read, path).has(changed));
}

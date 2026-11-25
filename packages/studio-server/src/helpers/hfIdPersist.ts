import { stampHfIdsInPlace } from "@hyperframes/parsers/hf-ids";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  defaultTreeAdapter,
  Parser,
  Tokenizer,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from "parse5";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { isInHiddenOrVendorDir, mkdirOwnedWithinProject, walkDir } from "./safePath.js";

const COMPOSITION_ID_TEXT = /data-composition-id\s*=/i;

// Where a browser stops nesting. The parser has no limit of its own and slows with every level.
const MAX_DEPTH = 512;

type Node = DefaultTreeAdapterTypes.Node;

const templateOf = new WeakMap<Node, Node>();

function above(node: Node): Node | undefined {
  return ("parentNode" in node && node.parentNode) || templateOf.get(node);
}

function refuseBelowMaxDepth(parent: Node): void {
  let depth = 1;
  for (let at = above(parent); at; at = above(at)) if (++depth > MAX_DEPTH) throw new RangeError();
}

/** parse5's tree adapter with the limits it lacks. `elements` is how many the page may make: closing
 * tags out of order makes the parser repeat open elements, without end for a small page. */
function limitedAdapter(elements: number): TreeAdapter<DefaultTreeAdapterMap> {
  return {
    ...defaultTreeAdapter,
    createElement(tagName, namespace, attrs) {
      if (--elements < 0) throw new RangeError();
      return defaultTreeAdapter.createElement(tagName, namespace, attrs);
    },
    appendChild(parent, child) {
      refuseBelowMaxDepth(parent);
      defaultTreeAdapter.appendChild(parent, child);
    },
    // Where a node sits among its siblings does not change which elements exist, and keeping the
    // order means a search or a shift of all the siblings for each node moved.
    insertBefore(parent, child) {
      refuseBelowMaxDepth(parent);
      defaultTreeAdapter.appendChild(parent, child);
    },
    insertTextBefore(parent, text) {
      defaultTreeAdapter.insertText(parent, text);
    },
    detachNode(node) {
      const siblings = node.parentNode?.childNodes;
      if (!siblings) return;
      const last = siblings.pop();
      if (last && last !== node)
        siblings[siblings[0] === node ? 0 : siblings.lastIndexOf(node)] = last;
      node.parentNode = null;
    },
    setTemplateContent(template, content) {
      templateOf.set(content, template);
      defaultTreeAdapter.setTemplateContent(template, content);
    },
  };
}

// More attributes on one tag than any real page has. The parser has no limit of its own, and compares
// each attribute name on a tag with every one before it.
const MAX_ATTRIBUTES = 4096;

class AttributeLimitedTokenizer extends Tokenizer {
  private named = 0;

  protected override _createStartTagToken(): void {
    this.named = 0;
    super._createStartTagToken();
  }

  protected override _createEndTagToken(): void {
    this.named = 0;
    super._createEndTagToken();
  }

  protected override _createAttr(firstCharacter: string): void {
    if (++this.named > MAX_ATTRIBUTES) throw new RangeError();
    super._createAttr(firstCharacter);
  }
}

/** The document a browser with scripting on builds from `html`. Throws past a limit. */
function parseAsABrowser(html: string): Node {
  // Every element a page asks for takes at least three characters, so a real page stays under this.
  const treeAdapter = limitedAdapter(html.length + 16);
  const parser = new Parser({ scriptingEnabled: true, treeAdapter });
  parser.tokenizer = new AttributeLimitedTokenizer(parser.options, parser);
  parser.tokenizer.write(html, true);
  return parser.document;
}

function hasCompositionElement(document: Node): boolean {
  const left: Node[] = [document];
  for (let node = left.pop(); node; node = left.pop()) {
    if ("attrs" in node && node.attrs.some((a) => a.name === "data-composition-id" && a.value))
      return true;
    if ("content" in node) left.push(node.content);
    if ("childNodes" in node) for (const child of node.childNodes) left.push(child);
  }
  return false;
}

/** True when `html`, read as a browser with scripting on reads it, has an element whose
 * `data-composition-id` attribute has a value; a template's content counts. The marker's text alone
 * is not enough, since Studio runs a composition's scripts on its own origin: the text inside a
 * script, style, comment or another attribute is no element. A page nested deeper than a browser
 * nests, or with thousands of attributes on one tag, is refused. */
export function isCompositionSource(html: string): boolean {
  if (!COMPOSITION_ID_TEXT.test(html)) return false;
  const hash = contentHash(html);
  let answer = answers.get(hash);
  if (answer === undefined) {
    try {
      answer = hasCompositionElement(parseAsABrowser(html));
    } catch {
      answer = false;
    }
    if (answers.size >= MAX_ANSWERS) answers.clear();
    answers.set(hash, answer);
  }
  return answer;
}

// The project listing asks about every page on every request; a page is parsed once per content.
const MAX_ANSWERS = 2048;
const answers = new Map<string, boolean>();

export const isCompositionPath = (relPath: string): boolean =>
  /\.html?$/i.test(relPath) && !isInHiddenOrVendorDir(relPath);

const STAMP_RECORD = join(".hyperframes", "hf-ids-stamped.json");

const contentHash = (text: string): string => createHash("sha1").update(text).digest("base64url");

/** Pins hf-ids into every composition in the project. A host runs it once before it serves or
 * watches the project: an id write during a session reaches Studio as an outside edit and reloads it.
 * A file whose content hash matches the last run's (kept in `.hyperframes`) is not parsed again. */
export function stampProjectHfIds(projectDir: string): void {
  const pass = stampPass(projectDir);
  while (!pass.next().done);
}

/** stampProjectHfIds for a host whose event loop must keep answering: it yields to the loop after each file. */
export async function stampProjectHfIdsAsync(projectDir: string): Promise<void> {
  const pass = stampPass(projectDir);
  while (!pass.next().done) await new Promise<void>((resolve) => setImmediate(resolve));
}

function* stampPass(projectDir: string): Generator<void> {
  const recordPath = join(projectDir, STAMP_RECORD);
  const last = readStampRecord(recordPath);
  const next: Record<string, string> = {};
  for (const file of walkDir(projectDir)) {
    if (!file.endsWith(".html") || isInHiddenOrVendorDir(file)) continue;
    const hash = hashAfterStamp(join(projectDir, file), last[file]);
    if (hash !== null) next[file] = hash;
    yield;
  }
  writeStampRecord(projectDir, recordPath, next);
}

function readStampRecord(recordPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(recordPath, "utf-8"));
  } catch {
    return {}; // first run, or an unreadable record: parse everything
  }
}

function writeStampRecord(projectDir: string, recordPath: string, next: Record<string, string>) {
  try {
    mkdirOwnedWithinProject(projectDir, dirname(recordPath));
    replaceFileAtomically(recordPath, JSON.stringify(next));
  } catch {
    // read-only project: the next start parses again
  }
}

/** The hash to record for a file after its stamp, or null when it is unreadable now and the preview route stamps it. */
function hashAfterStamp(absPath: string, recorded: string | undefined): string | null {
  let html: string;
  try {
    html = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  const hash = contentHash(html);
  if (recorded === hash || !isCompositionSource(html)) return hash;
  const stamped = stampFileHfIds(absPath);
  return stamped === null ? null : contentHash(stamped);
}

function openNoFollow(filePath: string, flags: number): number | null {
  // O_NOFOLLOW is undefined on Windows; opening without it is the platform norm there.
  const noFollow = constants.O_NOFOLLOW ?? 0;
  try {
    return openSync(filePath, flags | noFollow);
  } catch {
    return null;
  }
}

function isUnchanged(filePath: string, expected: string): boolean {
  const fd = openNoFollow(filePath, constants.O_RDONLY);
  if (fd === null) return false;
  try {
    return readFileSync(fd, "utf-8") === expected;
  } finally {
    closeSync(fd);
  }
}

/**
 * Read `filePath`, mint any missing `data-hf-id`s, write the stamped content
 * back if new ids were added, and return the stamped content. Every open of the path is
 * no-follow (POSIX) and the write renames a sibling temp file over it, so a symlink swapped
 * in at the path is never read or written through (CodeQL js/file-system-race).
 *
 * Falls back to read-only stamping when the file isn't writable (read-only
 * fs, sandbox) — serving stamped content without persisting is still correct;
 * ids are content-keyed so the SDK mints the same ones from the same bytes.
 *
 * Returns null when the file is missing, unreadable, or not a regular file.
 *
 * A write that lands while ids are minted is kept: the file is replaced only if
 * it still holds the bytes that were stamped, else it is left for the next open or save.
 */
export function stampFileHfIds(filePath: string): string | null {
  let fd: number | null = openNoFollow(filePath, constants.O_RDWR);
  let writable = true;
  if (fd === null) {
    fd = openNoFollow(filePath, constants.O_RDONLY);
    writable = false;
  }
  if (fd === null) return null;
  try {
    if (!fstatSync(fd).isFile()) return null;
    const html = readFileSync(fd, "utf-8");
    const normalized = stampHfIdsInPlace(html);
    // Attribute count, not string equality — linkedom serialization normalizes
    // quote style/whitespace even when no ids were minted.
    const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
    const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
    if (writable && idsAfter > idsBefore) {
      const mode = fstatSync(fd).mode;
      closeSync(fd);
      fd = null;
      if (isUnchanged(filePath, html)) replaceFileAtomically(filePath, normalized, mode);
    }
    return normalized;
  } catch (err) {
    console.warn("[hyperframes] stampFileHfIds: failed to stamp ids:", err);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

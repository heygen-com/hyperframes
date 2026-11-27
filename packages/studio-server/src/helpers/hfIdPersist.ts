import { stampHfIdsInPlace } from "@hyperframes/parsers/hf-ids";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultTreeAdapter,
  Parser,
  Tokenizer,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from "parse5";
import { replaceFileAtomically, replaceFileAtomicallyAsync } from "@hyperframes/core/atomic-file";
import {
  isInHiddenOrVendorDir,
  mkdirOwnedWithinProject,
  mkdirOwnedWithinProjectAsync,
  walkDir,
  walkDirAsync,
} from "./safePath.js";

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
    // Sibling order does not change which elements exist, and keeping it costs a search per node moved.
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

// The parser compares each attribute name on a tag with every one before it, without a limit.
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

function parseAsABrowserWithScripting(html: string): Node {
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
 * is not enough, since Studio runs a composition's scripts on its own origin. A page past a limit
 * above is refused. */
export function isCompositionSource(html: string): boolean {
  if (!COMPOSITION_ID_TEXT.test(html)) return false;
  const hash = contentHash(html);
  let answer = answersByContentHash.get(hash);
  if (answer === undefined) {
    try {
      answer = hasCompositionElement(parseAsABrowserWithScripting(html));
    } catch {
      answer = false;
    }
    if (answersByContentHash.size >= MAX_ANSWERS) answersByContentHash.clear();
    answersByContentHash.set(hash, answer);
  }
  return answer;
}

const MAX_ANSWERS = 2048;
const answersByContentHash = new Map<string, boolean>();

export const isCompositionPath = (relPath: string): boolean =>
  /\.html?$/i.test(relPath) && !isInHiddenOrVendorDir(relPath);

const STAMP_RECORD = join(".hyperframes", "hf-ids-stamped.json");

const contentHash = (text: string): string => createHash("sha1").update(text).digest("base64url");

// O_NOFOLLOW is undefined on Windows; opening without it is the platform norm there.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** A file opened for stamping: its text, its mode, and whether it opened for writing. */
interface Opened {
  html: string;
  mode: number;
  writable: boolean;
}

/** The file work a stamp asks for. The stamping rules live in the passes below; each driver only answers these. */
type FileStep =
  | { kind: "list"; dir: string }
  | { kind: "read"; path: string }
  | { kind: "open"; path: string }
  | { kind: "replace"; path: string; expected: string; content: string; mode: number }
  | { kind: "record"; projectDir: string; path: string; content: string }
  | { kind: "pause" };

type Pass<T> = Generator<FileStep, T, unknown>;

/** Pins hf-ids into every composition in the project. A host runs it once before it serves or
 * watches the project: an id write during a session reaches Studio as an outside edit and reloads it.
 * A file whose content hash matches the last run's (kept in `.hyperframes`) is not parsed again. */
export function stampProjectHfIds(projectDir: string): void {
  runSync(stampPass(projectDir));
}

/** stampProjectHfIds for a host whose event loop must keep answering: every file call runs on fs/promises, so a
 * project drive that stops answering holds a pool thread, never the caller's, and it yields after each file. */
export function stampProjectHfIdsAsync(projectDir: string): Promise<void> {
  return runAsync(stampPass(projectDir));
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
  return runSync(stampFile(filePath));
}

function* stampPass(projectDir: string): Pass<void> {
  const recordPath = join(projectDir, STAMP_RECORD);
  let last: Record<string, string> = {};
  try {
    last = JSON.parse((yield { kind: "read", path: recordPath }) as string);
  } catch {
    // first run, or an unreadable record: parse everything
  }
  const next: Record<string, string> = {};
  for (const file of (yield { kind: "list", dir: projectDir }) as string[]) {
    if (!file.endsWith(".html") || isInHiddenOrVendorDir(file)) continue;
    const hash = yield* hashAfterStamp(join(projectDir, file), last[file]);
    if (hash !== null) next[file] = hash;
    yield { kind: "pause" };
  }
  try {
    yield { kind: "record", projectDir, path: recordPath, content: JSON.stringify(next) };
  } catch {
    // read-only project: the next start parses again
  }
}

/** The hash to record for a file after its stamp, or null when it is unreadable now and the preview route stamps it. */
function* hashAfterStamp(absPath: string, recorded: string | undefined): Pass<string | null> {
  let html: string;
  try {
    html = (yield { kind: "read", path: absPath }) as string;
  } catch {
    return null;
  }
  const hash = contentHash(html);
  if (recorded === hash || !isCompositionSource(html)) return hash;
  const stamped = yield* stampFile(absPath);
  return stamped === null ? null : contentHash(stamped);
}

function* stampFile(filePath: string): Pass<string | null> {
  try {
    const opened = (yield { kind: "open", path: filePath }) as Opened | null;
    if (opened === null) return null;
    const { html, mode, writable } = opened;
    const normalized = stampHfIdsInPlace(html);
    // Attribute count, not string equality — linkedom serialization normalizes
    // quote style/whitespace even when no ids were minted.
    const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
    const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
    if (writable && idsAfter > idsBefore)
      yield { kind: "replace", path: filePath, expected: html, content: normalized, mode };
    return normalized;
  } catch (err) {
    console.warn("[hyperframes] stampFileHfIds: failed to stamp ids:", err);
    return null;
  }
}

function runSync<T>(pass: Pass<T>): T {
  let step = pass.next();
  while (!step.done) {
    let answer: unknown;
    try {
      answer = answerSync(step.value);
    } catch (error) {
      step = pass.throw(error);
      continue;
    }
    step = pass.next(answer);
  }
  return step.value;
}

async function runAsync<T>(pass: Pass<T>): Promise<T> {
  let step = pass.next();
  while (!step.done) {
    let answer: unknown;
    try {
      answer = await answerAsync(step.value);
    } catch (error) {
      step = pass.throw(error);
      continue;
    }
    step = pass.next(answer);
  }
  return step.value;
}

function answerSync(step: FileStep): unknown {
  switch (step.kind) {
    case "list":
      return walkDir(step.dir);
    case "read":
      return readFileSync(step.path, "utf-8");
    case "open":
      return openSyncForStamp(step.path);
    case "replace":
      if (unchangedSync(step.path, step.expected))
        replaceFileAtomically(step.path, step.content, step.mode);
      return undefined;
    case "record":
      mkdirOwnedWithinProject(step.projectDir, dirname(step.path));
      replaceFileAtomically(step.path, step.content);
      return undefined;
    case "pause":
      return undefined;
    default:
      return unknownStep(step);
  }
}

async function answerAsync(step: FileStep): Promise<unknown> {
  switch (step.kind) {
    case "list":
      return walkDirAsync(step.dir);
    case "read":
      return readFile(step.path, "utf-8");
    case "open":
      return openAsyncForStamp(step.path);
    case "replace":
      if (await unchangedAsync(step.path, step.expected))
        await replaceFileAtomicallyAsync(step.path, step.content, step.mode);
      return undefined;
    case "record":
      await mkdirOwnedWithinProjectAsync(step.projectDir, dirname(step.path));
      await replaceFileAtomicallyAsync(step.path, step.content);
      return undefined;
    case "pause":
      return new Promise<void>((resolve) => setImmediate(resolve));
    default:
      return unknownStep(step);
  }
}

function unknownStep(step: never): never {
  throw new Error(`Unknown stamp step: ${JSON.stringify(step)}`);
}

function openNoFollow(filePath: string, flags: number): number | null {
  try {
    return openSync(filePath, flags | NO_FOLLOW);
  } catch {
    return null;
  }
}

/** Opened for writing when it can be, else read only; null when it can't be opened or is not a regular file. */
function openSyncForStamp(filePath: string): Opened | null {
  let fd = openNoFollow(filePath, constants.O_RDWR);
  const writable = fd !== null;
  fd ??= openNoFollow(filePath, constants.O_RDONLY);
  if (fd === null) return null;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    return { html: readFileSync(fd, "utf-8"), mode: stat.mode, writable };
  } finally {
    closeSync(fd);
  }
}

async function openNoFollowAsync(filePath: string, flags: number) {
  try {
    return await open(filePath, flags | NO_FOLLOW);
  } catch {
    return null;
  }
}

async function openAsyncForStamp(filePath: string): Promise<Opened | null> {
  let handle = await openNoFollowAsync(filePath, constants.O_RDWR);
  const writable = handle !== null;
  handle ??= await openNoFollowAsync(filePath, constants.O_RDONLY);
  if (handle === null) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    return { html: await handle.readFile("utf-8"), mode: stat.mode, writable };
  } finally {
    await handle.close();
  }
}

function unchangedSync(filePath: string, expected: string): boolean {
  const fd = openNoFollow(filePath, constants.O_RDONLY);
  if (fd === null) return false;
  try {
    return readFileSync(fd, "utf-8") === expected;
  } finally {
    closeSync(fd);
  }
}

async function unchangedAsync(filePath: string, expected: string): Promise<boolean> {
  const handle = await openNoFollowAsync(filePath, constants.O_RDONLY);
  if (handle === null) return false;
  try {
    return (await handle.readFile("utf-8")) === expected;
  } finally {
    await handle.close();
  }
}

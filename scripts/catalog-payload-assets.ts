/**
 * Asset handling for catalog preview payloads.
 *
 * Kept apart from the payload generator so the reference-matching rules can be
 * tested without pulling in the renderer: everything here is pure string and
 * file work, and the regex below has already been wrong twice in ways only a
 * test catches.
 */

import { createHash } from "node:crypto";
import {
  type Dirent,
  mkdirSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
  realpathSync,
  openSync,
  fstatSync,
  closeSync,
  constants,
} from "node:fs";
import { extname, join, resolve, relative, isAbsolute, sep } from "node:path";

export const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "image/vnd.radiance",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * Extensions the docs host actually publishes out of `docs/public`, verified by
 * fetching one file of each type from a deployed preview.
 *
 * Anything here is written once and linked. Anything else — `.glb`, `.js`,
 * `.css` — is dropped from the deploy with no build error, so it has to travel
 * inside the payload as a data URI instead. Getting this set wrong is not a
 * build failure, it is a 404 nobody sees until a reader opens the page.
 */
export const HOSTED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".woff2",
  ".woff",
  ".ttf",
  ".otf",
  ".wav",
  ".mp3",
  ".mp4",
  ".webm",
]);

/** A reference with any query string or fragment removed. */
function pathPart(ref: string): string {
  return ref.split(/[?#]/)[0] ?? ref;
}

const NON_FILE_REFERENCE = /^(https?:|data:|blob:|mailto:|#|%23|\/\/)/i;
const LOCAL_REFERENCE_PATTERNS = [
  /(?<![\w$])(?:src|href)\s*=\s*["']([^"']+)["']/gi,
  /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
];
const QUOTED_FILE_NAME = /["']([^"'\s]+\.[a-z0-9]{2,5})["']/gi;

/** A candidate that is not a URL or fragment and carries an extension we know. */
function isFileReference(ref: string): boolean {
  return !NON_FILE_REFERENCE.test(ref) && Boolean(MIME_TYPES[extname(pathPart(ref)).toLowerCase()]);
}

function capturedRefs(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1] ?? "");
}

/**
 * Local files the composition loads from beside itself. A `srcdoc` iframe has
 * no base URL of its own, so these would otherwise resolve against the docs
 * page and 404.
 *
 * Two rules stop this over-matching. The attribute pattern requires a
 * non-identifier character before `src`, or a shader assigned to `vertSrc`
 * reads as a file reference. And a candidate only counts once it carries an
 * extension we know, which drops `url(#noise)` filter references, `blob:`
 * juggling, and bare CSS keywords.
 */
export function localReferences(html: string): string[] {
  const refs = LOCAL_REFERENCE_PATTERNS.flatMap((pattern) => capturedRefs(html, pattern));
  return [...new Set(refs.filter((ref) => !ref.includes("\n") && isFileReference(ref)))];
}

/**
 * Files a script loads by name, such as `loader.load("models/iphone.glb")`.
 *
 * These cannot be told apart from ordinary strings by shape alone, so unlike
 * the definite references above they are only acted on when the name resolves
 * to a real file in the item's own directory, and a miss is ignored rather than
 * failing the item. Without this pass a 3D model stayed a relative path, which
 * resolves against the docs page inside a `srcdoc` iframe and 404s: the preview
 * renders, just with nothing in it.
 */
export function probableReferences(html: string): string[] {
  const definite = new Set(localReferences(html));
  const refs = capturedRefs(html, QUOTED_FILE_NAME);
  return [...new Set(refs.filter((ref) => !definite.has(ref) && isFileReference(ref)))];
}

export interface AssetResult {
  html: string;
  /** Written once to the shared directory and linked. */
  hosted: number;
  /** Carried inside the payload because the host will not publish the type. */
  inlined: number;
  /** References left as they were, so the caller can refuse the payload. */
  unresolved: string[];
}

function isWithin(root: string, filePath: string): boolean {
  const rel = relative(root, filePath);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isMissingFile(error: unknown): boolean {
  return hasErrnoCode(error, "ENOENT") || hasErrnoCode(error, "ENOTDIR");
}

function orNullIfMissing<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/** Keep oversized or concurrently growing directory assets within the read budget. */
function readWithinBudget(fd: number, maxBytes: number): Buffer<ArrayBuffer> {
  const chunks: Buffer<ArrayBuffer>[] = [];
  let remaining = maxBytes + 1;
  while (remaining > 0) {
    const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
    const count = readSync(fd, chunk, 0, chunk.length, null);
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    remaining -= count;
  }
  return Buffer.concat(chunks);
}

const realpathOrNull = (path: string) => orNullIfMissing(() => realpathSync(path));

function isWithinRealRoot(root: string, source: string): boolean {
  const realRoot = realpathOrNull(root);
  return realRoot !== null && isWithin(realRoot, source);
}

function realPathWithin(root: string, filePath: string): string | null {
  if (!isWithin(root, filePath)) return null;
  const source = realpathOrNull(filePath);
  return source !== null && isWithinRealRoot(root, source) ? source : null;
}

const isNotRegularFile = (path: string) => !statSync(path, { throwIfNoEntry: false })?.isFile();

function openOrNull(source: string): number | null {
  try {
    // Nonblocking mode lets fstat reject named pipes without waiting for a writer.
    return openSync(source, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (isMissingFile(error) || isNotRegularFile(source)) return null;
    throw error;
  }
}

function readOpenFile(fd: number, maxBytes?: number): Buffer<ArrayBuffer> | null {
  if (!fstatSync(fd).isFile()) return null;
  return maxBytes === undefined ? readFileSync(fd) : readWithinBudget(fd, maxBytes);
}

/** Read one checked file from the prepared project, including internal links. */
function readProjectFile(
  root: string,
  filePath: string,
  maxBytes?: number,
): Buffer<ArrayBuffer> | null {
  const source = realPathWithin(root, filePath);
  const fd = source === null ? null : openOrNull(source);
  if (fd === null) return null;
  try {
    return readOpenFile(fd, maxBytes);
  } finally {
    closeSync(fd);
  }
}

export interface AssetTarget {
  /** Directory shared by every item, so one font is stored once. */
  dir: string;
  /** URL the directory is served from. */
  urlBase: string;
}

function ensureRealDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true });
  if (!lstatSync(dir).isDirectory()) throw new Error("Catalog cache must be a real directory");
}

function linkIfAbsent(staged: string, dest: string): void {
  try {
    linkSync(staged, dest);
  } catch (error) {
    if (!hasErrnoCode(error, "EEXIST")) throw error;
  }
}

function removeQuietly(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function publishExclusive(bytes: Buffer<ArrayBuffer>, dest: string, dir: string): void {
  const staging = mkdtempSync(join(dir, ".hf-asset-"));
  try {
    const staged = join(staging, "content");
    writeFileSync(staged, bytes, { flag: "wx" });
    linkIfAbsent(staged, dest);
  } finally {
    // Cleanup must not mask a publication error or fail an already published asset.
    removeQuietly(staging);
  }
}

/** Publish a complete cache entry without replacing a competing file or link. */
function cacheAsset(bytes: Buffer<ArrayBuffer>, ext: string, target: AssetTarget): string {
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${ext}`;
  const dest = join(target.dir, name);
  // Cache hits need no writable directory. A miss still has to win linkSync.
  if (lstatSync(dest, { throwIfNoEntry: false })) return name;
  ensureRealDirectory(target.dir);
  publishExclusive(bytes, dest, target.dir);
  return name;
}

interface AssetContext {
  root: string;
  projectDir: string;
  target: AssetTarget;
  scriptsInlinedByCaller: boolean;
}

type CandidateOutcome =
  | { kind: "ignored" | "unresolved" }
  | { kind: "hosted" | "inlined"; value: string };

const IGNORED: CandidateOutcome = { kind: "ignored" };
const UNRESOLVED: CandidateOutcome = { kind: "unresolved" };

/** The caller's inliner matches these script tags by their original src, so they stay untouched. */
const isCallerInlinedScript = (ext: string, context: AssetContext): boolean =>
  context.scriptsInlinedByCaller && (ext === ".js" || ext === ".mjs");

function classifyBytes(
  source: string,
  bytes: Buffer<ArrayBuffer>,
  context: AssetContext,
): CandidateOutcome {
  const ext = extname(source).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime || isCallerInlinedScript(ext, context)) return UNRESOLVED;
  if (HOSTED_EXTENSIONS.has(ext)) {
    return {
      kind: "hosted",
      value: `${context.target.urlBase}/${cacheAsset(bytes, ext, context.target)}`,
    };
  }
  return { kind: "inlined", value: `data:${mime};base64,${bytes.toString("base64")}` };
}

function classifyCandidate(
  candidate: { ref: string; strict: boolean },
  context: AssetContext,
): CandidateOutcome {
  // A composition reaching outside its own directory would pull an arbitrary
  // file from the build machine into a published payload.
  const source = resolve(context.projectDir, pathPart(candidate.ref));
  const bytes = readProjectFile(context.root, source);
  // A name a script passed around that turned out not to be a file is just
  // a string; only a reference we are sure about counts as a broken one.
  if (bytes === null) return candidate.strict ? UNRESOLVED : IGNORED;
  return classifyBytes(source, bytes, context);
}

function applyOutcome(result: AssetResult, ref: string, outcome: CandidateOutcome): void {
  if (outcome.kind === "unresolved") result.unresolved.push(ref);
  if (outcome.kind === "hosted" || outcome.kind === "inlined") {
    result.html = result.html.split(ref).join(outcome.value);
    result[outcome.kind] += 1;
  }
}

/**
 * Point every local reference at something the browser can fetch.
 *
 * Assets are content-addressed and shared across items rather than inlined per
 * item. The catalog's fonts are the reason: a handful of files were being
 * base64'd into a hundred payloads apiece, which cost tens of megabytes in the
 * repository to say the same thing over and over. Hashing also means a
 * regenerated payload is byte-identical when nothing changed.
 *
 * Types the host will not publish still travel as data URIs, because a link to
 * a file that 404s is worse than a larger payload.
 */
export function processAssets(
  html: string,
  projectDir: string,
  target: AssetTarget,
  scriptsInlinedByCaller = false,
): AssetResult {
  const context: AssetContext = {
    root: resolve(projectDir),
    projectDir,
    target,
    scriptsInlinedByCaller,
  };
  const candidates = [
    ...localReferences(html).map((ref) => ({ ref, strict: true })),
    ...probableReferences(html).map((ref) => ({ ref, strict: false })),
  ];
  const result: AssetResult = { html, hosted: 0, inlined: 0, unresolved: [] };
  for (const candidate of candidates) {
    applyOutcome(result, candidate.ref, classifyCandidate(candidate, context));
  }
  return result;
}

/** `image/png` -> `.png`, for naming a blob that arrives without a filename. */
const EXTENSION_FOR_MIME: Record<string, string> = Object.entries(MIME_TYPES).reduce(
  (acc, [ext, mime]) => (acc[mime] ? acc : { ...acc, [mime]: ext }),
  {} as Record<string, string>,
);

/**
 * Below this, a data URI is cheaper than the request it would cost to fetch.
 * Fonts, the reason this exists, are far above it.
 */
const EXTERNALIZE_MIN_BYTES = 4096;

/**
 * Pull large data URIs already baked into the composition out into shared files.
 *
 * Compositions arrive with their fonts embedded, so `processAssets` never sees
 * them as references and they survive into the payload untouched. Across the
 * catalog that was 53.8 MB of base64, most of it the same few typefaces
 * repeated. Hashing gives one copy per distinct file no matter how many items
 * embed it.
 */
export function externalizeDataUris(
  html: string,
  target: AssetTarget,
): { html: string; externalized: number } {
  let externalized = 0;
  const out = html.replace(
    /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi,
    (whole, mime: string, blob: string) => {
      const ext = EXTENSION_FOR_MIME[mime.toLowerCase()];
      if (!ext || !HOSTED_EXTENSIONS.has(ext)) return whole;

      const bytes = Buffer.from(blob, "base64");
      if (bytes.length < EXTERNALIZE_MIN_BYTES) return whole;

      const name = cacheAsset(bytes, ext, target);
      externalized += 1;
      return `${target.urlBase}/${name}`;
    },
  );
  return { html: out, externalized };
}

/** Enumerates publishable paths without using pathname sizes to authorize reads. `.js`/`.mjs`/
 * `.hdr` are never hosted (see catalog-script-inlining.ts); `source/` (pre-compile input) is skipped. */
function* hostedPaths(from: string, rel = ""): Generator<string> {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (isSkippedEntry(entry, rel)) continue;
    yield* hostedEntry(from, rel, entry);
  }
}

const isSkippedEntry = (entry: Dirent, rel: string): boolean =>
  entry.isSymbolicLink() || (!rel && entry.name === "source");

function* hostedEntry(from: string, rel: string, entry: Dirent): Generator<string> {
  const childRel = rel ? `${rel}/${entry.name}` : entry.name;
  if (entry.isDirectory()) yield* hostedPaths(join(from, entry.name), childRel);
  else if (HOSTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) yield childRel;
}

/** Internal directory aliases share the buffers already collected at their real paths. */
function mirrorPrefixWithin(root: string, downloads: string): string | null {
  if (!isWithin(root, downloads) || !statSync(downloads).isDirectory()) return null;
  const rel = relative(root, downloads).split(sep).join("/");
  return rel ? `${rel}/` : "";
}

function downloadMirrorPrefix(projectDir: string): string | null {
  return orNullIfMissing(() =>
    mirrorPrefixWithin(realpathSync(projectDir), realpathSync(join(projectDir, "_downloads"))),
  );
}

function isMirrorPair(file: {
  path?: string;
  target?: string;
}): file is { path: string; target: string } {
  return Boolean(file.path && file.target && file.path !== file.target);
}

// target -> path for every pair mirrorRegistryTargets already copied, so a
// target's bytes can be reused instead of re-read and re-charged.
function installMirrorTargets(projectDir: string): Map<string, string> {
  const bytes = readProjectFile(projectDir, join(projectDir, "registry-item.json"), 1_000_000);
  if (bytes === null) return new Map();
  const manifest = JSON.parse(bytes.toString("utf-8")) as {
    files?: { path?: string; target?: string }[];
  };
  return new Map(
    (manifest.files ?? []).filter(isMirrorPair).map((file) => [file.target, file.path]),
  );
}

/**
 * Publish the item's own directory and hand back a base URL for it.
 *
 * Some compositions build their paths at run time —
 * `"compositions/components/" + texture + ".png"` for the texture masks, a
 * downloaded font under `_remote_media/` — and no amount of scanning the markup
 * can see a string that does not exist until a script concatenates it. Serving
 * the directory and pointing `<base>` at it makes every relative path the
 * composition can invent resolve, whether we predicted it or not.
 *
 * Only publishable types are copied; a composition needing something the host
 * drops still falls back to inlining, which is handled by the caller.
 */
/**
 * What an item may add by publishing its own directory.
 *
 * The texture sheet is the reason: 66 masks published under both path layouts,
 * about 11.4 MB. The browser fetches them only when the tile plays, so this
 * costs repository size, not page weight. An item over budget has no live
 * preview, which the docs catalog check rejects.
 */
export const MAX_HOSTED_DIRECTORY_BYTES = 12_000_000;

// "not-needed" and "over-budget" both leave nothing published, but the caller
// must not treat them alike: an over-budget item still needs the directory,
// so it has to fall back to its recorded video instead of shipping with dead
// relative references and no <base> to resolve them against.
export type HostItemDirectoryResult =
  | { readonly status: "not-needed" }
  | { readonly status: "hosted"; readonly baseHref: string }
  | { readonly status: "over-budget" };

interface ChargeState {
  files: Map<string, Buffer<ArrayBuffer>>;
  total: number;
}

// Reads one path against the remaining budget, charging its bytes toward
// `state.total`. Returns false only when adding it would overflow the
// budget, so the caller can abort before that file is ever recorded.
function chargeRead(
  projectDir: string,
  path: string,
  maxBytes: number,
  state: ChargeState,
): boolean {
  const bytes = readProjectFile(projectDir, join(projectDir, path), maxBytes - state.total);
  if (bytes === null) return true;
  state.total += bytes.length;
  if (state.total > maxBytes) return false;
  state.files.set(path, bytes);
  return true;
}

function readDirect(
  projectDir: string,
  paths: string[],
  maxBytes: number,
  state: ChargeState,
): boolean {
  for (const path of paths) {
    if (!chargeRead(projectDir, path, maxBytes, state)) return false;
  }
  return true;
}

// A mirrored path's source may already be in `state.files` (reuse, no re-read
// or re-charge) or may itself have been dropped as too large or unreadable,
// in which case it falls back to reading and charging the target directly.
function readMirrored(
  projectDir: string,
  paths: string[],
  installTargets: Map<string, string>,
  maxBytes: number,
  state: ChargeState,
): boolean {
  for (const path of paths) {
    const source = state.files.get(installTargets.get(path) as string);
    if (source !== undefined) {
      state.files.set(path, source);
      continue;
    }
    if (!chargeRead(projectDir, path, maxBytes, state)) return false;
  }
  return true;
}

function collectWithinBudget(projectDir: string): Map<string, Buffer<ArrayBuffer>> | null {
  const installTargets = installMirrorTargets(projectDir);
  const state: ChargeState = { files: new Map(), total: 0 };
  const maxBytes = MAX_HOSTED_DIRECTORY_BYTES;

  // Read every path that is not a known install-layout duplicate first, so a
  // target's source is always already in `state.files` by the time the target
  // is handled below, regardless of the order the filesystem yields entries in.
  const allPaths = [...hostedPaths(projectDir)];
  const mirrored = allPaths.filter((path) => installTargets.has(path));
  const direct = allPaths.filter((path) => !installTargets.has(path));
  const fits =
    readDirect(projectDir, direct, maxBytes, state) &&
    readMirrored(projectDir, mirrored, installTargets, maxBytes, state);
  return fits ? state.files : null;
}

function publishFile(destDir: string, path: string, bytes: Buffer<ArrayBuffer>): void {
  const to = join(destDir, path);
  mkdirSync(join(to, ".."), { recursive: true });
  writeFileSync(to, bytes);
}

const withoutMirrorPrefix = (path: string, prefix: string | null): string | null =>
  prefix !== null && path.startsWith(prefix) ? path.slice(prefix.length) : null;

function publishAll(
  files: Map<string, Buffer<ArrayBuffer>>,
  destDir: string,
  mirrorPrefix: string | null,
): void {
  for (const [path, bytes] of files) publishFile(destDir, path, bytes);
  // Compiler references omit `_downloads/`. Preserve both spellings and the
  // existing mirror-wins collision order without reopening any source file.
  for (const [path, bytes] of files) {
    const alias = withoutMirrorPrefix(path, mirrorPrefix);
    if (alias !== null) publishFile(destDir, alias, bytes);
  }
}

export function hostItemDirectory(
  projectDir: string,
  destDir: string,
  urlBase: string,
): HostItemDirectoryResult {
  const mirrorPrefix = downloadMirrorPrefix(projectDir);
  const files = collectWithinBudget(projectDir);
  if (files === null) return { status: "over-budget" };
  // Publish only after the entire item fits, reusing the bytes read once.
  publishAll(files, destDir, mirrorPrefix);
  return files.size > 0 ? { status: "hosted", baseHref: urlBase } : { status: "not-needed" };
}

/**
 * Point the document at that base, ahead of anything that could resolve a URL.
 *
 * A `srcdoc` document has no base of its own, so relative paths resolve against
 * the docs page and 404. The tag has to be the first thing in the head: a
 * `<base>` only governs what follows it.
 */
export function withBaseHref(html: string, href: string): string {
  if (!href) return html;
  const tag = `<base href="${href}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  if (/<html[^>]*>/i.test(html))
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
  return `${tag}${html}`;
}

/**
 * Turn a mounted sub-composition into one the browser can fetch on its own.
 *
 * An interactive preview ships uncompiled so its values stay changeable, which
 * leaves `data-composition-src` pointing at a sibling `.html`. That is the one
 * type the docs host will not publish, so the file is carried inline as a data
 * URI instead: the runtime still mounts it at run time, and the values on the
 * host still govern it.
 */
export function inlineMountedComposition(html: string, projectDir: string): string {
  return html.replace(
    /data-composition-src=(["'])([^"']+)\1/gi,
    (whole, quote: string, ref: string) => {
      if (/^(https?:|data:)/i.test(ref)) return whole;
      const source = resolve(projectDir, ref.replace(/^\.\//, "").split(/[?#]/)[0] ?? ref);
      const bytes = readProjectFile(resolve(projectDir), source);
      if (bytes === null) return whole;
      const encoded = bytes.toString("base64");
      return `data-composition-src=${quote}data:text/html;base64,${encoded}${quote}`;
    },
  );
}

/**
 * Drop the values a demo pinned onto its own mount.
 *
 * A demo picks striking values to show itself off, and the runtime layers those
 * over anything the reader chooses, so every control looked dead. Removing them
 * leaves the declared defaults, which is the state the panel starts in.
 */
export function clearPinnedVariableValues(html: string): string {
  return html.replace(/\sdata-variable-values=(?:"[^"]*"|'[^']*')/gi, "");
}

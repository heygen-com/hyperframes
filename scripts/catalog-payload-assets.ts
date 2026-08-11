/**
 * Asset handling for catalog preview payloads.
 *
 * Kept apart from the payload generator so the reference-matching rules can be
 * tested without pulling in the renderer: everything here is pure string and
 * file work, and the regex below has already been wrong twice in ways only a
 * test catches.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

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
  const found = new Set<string>();
  const patterns = [
    /(?<![\w$])(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const [, ref] of html.matchAll(pattern)) {
      if (!ref) continue;
      // `%23` is an encoded `#`: an in-document SVG filter reference, not a file.
      if (/^(https?:|data:|blob:|mailto:|#|%23|\/\/)/i.test(ref)) continue;
      if (ref.includes("\n")) continue;
      if (!MIME_TYPES[extname(pathPart(ref)).toLowerCase()]) continue;
      found.add(ref);
    }
  }
  return [...found];
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
  const found = new Set<string>();
  for (const [, ref] of html.matchAll(/["']([^"'\s]+\.[a-z0-9]{2,5})["']/gi)) {
    if (!ref || definite.has(ref)) continue;
    if (/^(https?:|data:|blob:|mailto:|#|%23|\/\/)/i.test(ref)) continue;
    if (!MIME_TYPES[extname(pathPart(ref)).toLowerCase()]) continue;
    found.add(ref);
  }
  return [...found];
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

export interface AssetTarget {
  /** Directory shared by every item, so one font is stored once. */
  dir: string;
  /** URL the directory is served from. */
  urlBase: string;
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
export function processAssets(html: string, projectDir: string, target: AssetTarget): AssetResult {
  const root = resolve(projectDir);
  let out = html;
  let hosted = 0;
  let inlined = 0;
  const unresolved: string[] = [];

  const definite = localReferences(html);
  const candidates = [
    ...definite.map((ref) => ({ ref, strict: true })),
    ...probableReferences(html).map((ref) => ({ ref, strict: false })),
  ];

  for (const { ref, strict } of candidates) {
    const source = resolve(projectDir, pathPart(ref));

    // A composition reaching outside its own directory would pull an arbitrary
    // file from the build machine into a published payload.
    const contained = source === root || source.startsWith(`${root}/`);
    if (!contained || !existsSync(source) || !statSync(source).isFile()) {
      // A name a script passed around that turned out not to be a file is just
      // a string; only a reference we are sure about counts as a broken one.
      if (strict) unresolved.push(ref);
      continue;
    }

    const ext = extname(source).toLowerCase();
    const mime = MIME_TYPES[ext];
    if (!mime) {
      unresolved.push(ref);
      continue;
    }

    const bytes = readFileSync(source);
    if (HOSTED_EXTENSIONS.has(ext)) {
      const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${ext}`;
      const dest = join(target.dir, name);
      if (!existsSync(dest)) {
        mkdirSync(target.dir, { recursive: true });
        writeFileSync(dest, bytes);
      }
      out = out.split(ref).join(`${target.urlBase}/${name}`);
      hosted += 1;
      continue;
    }

    out = out.split(ref).join(`data:${mime};base64,${bytes.toString("base64")}`);
    inlined += 1;
  }

  return { html: out, hosted, inlined, unresolved };
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

      const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${ext}`;
      const dest = join(target.dir, name);
      if (!existsSync(dest)) {
        mkdirSync(target.dir, { recursive: true });
        writeFileSync(dest, bytes);
      }
      externalized += 1;
      return `${target.urlBase}/${name}`;
    },
  );
  return { html: out, externalized };
}

/** Copy a directory's publishable files into `destDir`, flattening one level. */
function walkInto(from: string, rel: string, destDir: string, onCopy: () => void): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const childFrom = join(from, entry.name);
    if (entry.isDirectory()) {
      walkInto(childFrom, childRel, destDir, onCopy);
      continue;
    }
    if (!HOSTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const to = join(destDir, childRel);
    mkdirSync(join(to, ".."), { recursive: true });
    writeFileSync(to, readFileSync(childFrom));
    onCopy();
  }
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
/** Publishable bytes an item would add, counted before anything is written. */
function directoryBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directoryBytes(child);
      continue;
    }
    if (!HOSTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    total += statSync(child).size;
  }
  return total;
}

/**
 * What an item may add by publishing its own directory.
 *
 * The texture sheets are the reason: one ships 66 masks, twice over, for 12 MB
 * — against a whole catalog that is otherwise around 30 MB. An item over budget
 * keeps the recorded video it already had, which is no worse than before.
 */
export const MAX_HOSTED_DIRECTORY_BYTES = 2_000_000;

export function hostItemDirectory(projectDir: string, destDir: string, urlBase: string): string {
  if (directoryBytes(projectDir) > MAX_HOSTED_DIRECTORY_BYTES) return "";
  let copied = 0;

  const walk = (from: string, rel: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      // Nothing here should ever leave the prepared copy, and a symlink is the
      // one entry that could point back out of it.
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childFrom = join(from, entry.name);
      if (entry.isDirectory()) {
        walk(childFrom, childRel);
        continue;
      }
      if (!HOSTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      const to = join(destDir, childRel);
      mkdirSync(join(to, ".."), { recursive: true });
      writeFileSync(to, readFileSync(childFrom));
      copied += 1;
    }
  };

  // Both layouts are published. The prepared copy holds each asset twice, once
  // as the registry stores it and once at its install path, and which one a
  // composition asks for differs per item: the texture masks use the registry
  // spelling, the caption textures the install one. Guessing wrong is a 404 at
  // run time, so the budget below is what keeps the cost in check instead.
  walk(projectDir, "");

  // The compiler pulls remote media into `_downloads/` but rewrites references
  // as if the document sat inside it, so `_remote_media/x.woff2` has to resolve
  // from the item root too. Mirroring rather than moving keeps both spellings
  // working, and the files are content-identical either way.
  const downloads = join(projectDir, "_downloads");
  if (existsSync(downloads) && statSync(downloads).isDirectory()) {
    walkInto(downloads, "", destDir, () => (copied += 1));
  }

  return copied > 0 ? urlBase : "";
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
      if (!source.startsWith(resolve(projectDir)) || !existsSync(source)) return whole;
      const encoded = readFileSync(source).toString("base64");
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

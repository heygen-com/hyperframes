/**
 * Asset handling for catalog preview payloads.
 *
 * Kept apart from the payload generator so the reference-matching rules can be
 * tested without pulling in the renderer: everything here is pure string and
 * file work, and the regex below has already been wrong twice in ways only a
 * test catches.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

  for (const ref of localReferences(html)) {
    const source = resolve(projectDir, pathPart(ref));

    // A composition reaching outside its own directory would pull an arbitrary
    // file from the build machine into a published payload.
    const contained = source === root || source.startsWith(`${root}/`);
    if (!contained || !existsSync(source) || !statSync(source).isFile()) {
      unresolved.push(ref);
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

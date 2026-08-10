/**
 * Asset inlining for catalog preview payloads.
 *
 * Kept apart from the payload generator so the reference-matching rules can be
 * tested without pulling in the renderer: everything here is pure string and
 * file work, and the regex below has already been wrong twice in ways only a
 * test catches.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

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
 * Local files the composition loads from beside itself. A `srcdoc` iframe has
 * no base URL of its own, so these would otherwise resolve against the docs
 * page and 404.
 *
 * Two rules stop this over-matching. The attribute pattern requires a
 * non-identifier character before `src`, or a shader assigned to `vertSrc`
 * reads as a file reference. And a candidate only counts once it carries an
 * extension we know how to inline, which drops `url(#noise)` filter
 * references, `blob:` juggling, and bare CSS keywords.
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
      if (!MIME_TYPES[extname(ref.split(/[?#]/)[0]).toLowerCase()]) continue;
      found.add(ref);
    }
  }
  return [...found];
}

export interface InlineResult {
  html: string;
  inlined: number;
  /** References that had to stay as they were, so the caller can refuse the payload. */
  unresolved: string[];
}

/**
 * Replace every local reference with a data URI holding the file itself.
 *
 * The docs host publishes only JSON and images out of `docs/public`, so copying
 * an item's fonts, scripts or models next to the payload would leave them
 * 404ing. Inlining sidesteps the file-type restriction entirely: the payload is
 * a JSON string, and a data URI is just more string. It also keeps a preview to
 * a single request, so a composition cannot render half-dressed while its
 * assets are still in flight.
 */
export function inlineAssets(html: string, projectDir: string): InlineResult {
  const root = resolve(projectDir);
  let out = html;
  let inlined = 0;
  const unresolved: string[] = [];

  for (const ref of localReferences(html)) {
    const [cleanRef] = ref.split(/[?#]/);
    const source = resolve(projectDir, cleanRef);

    // A composition reaching outside its own directory would pull an arbitrary
    // file from the build machine into a published payload.
    const contained = source === root || source.startsWith(`${root}/`);
    if (!contained || !existsSync(source) || !statSync(source).isFile()) {
      unresolved.push(ref);
      continue;
    }

    const mime = MIME_TYPES[extname(source).toLowerCase()];
    if (!mime) {
      unresolved.push(ref);
      continue;
    }

    const encoded = readFileSync(source).toString("base64");
    out = out.split(ref).join(`data:${mime};base64,${encoded}`);
    inlined += 1;
  }

  return { html: out, inlined, unresolved };
}

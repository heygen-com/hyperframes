import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { isNonRelativeUrl } from "@hyperframes/core";
import { resolveCompositionSrc } from "@hyperframes/parsers/asset-resolution";
import { HF_COLOR_GRADING_ATTR } from "@hyperframes/core/color-grading";

const REFERENCE_ATTRS = ["src", "href", "poster", "xlink:href"];
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;

export interface Reference {
  raw: string;
  composition: boolean;
  follow: boolean;
  colorGradingLut?: boolean;
}

function unquote(value: string): string {
  const first = value[0];
  return value.length >= 2 && (first === '"' || first === "'") && value.at(-1) === first
    ? value.slice(1, -1).trim()
    : value;
}

export function cssReferences(css: string): Reference[] {
  const refs: Reference[] = [];
  for (let at = css.indexOf("url("); at !== -1; ) {
    const close = css.indexOf(")", at + 4);
    if (close === -1) break;
    const raw = unquote(css.slice(at + 4, close).trim());
    if (raw) refs.push({ raw, composition: false, follow: true });
    at = css.indexOf("url(", close + 1);
  }
  for (const [, , raw] of css.matchAll(/@import\s+(["'])(.+?)\1/g)) {
    if (raw?.trim()) refs.push({ raw: raw.trim(), composition: false, follow: true });
  }
  return refs;
}

function colorGradingLut(value: string | null): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    const lut: unknown = typeof parsed === "object" && parsed ? Reflect.get(parsed, "lut") : null;
    const src: unknown = typeof lut === "object" && lut ? Reflect.get(lut, "src") : lut;
    return typeof src === "string" && src.trim() ? src.trim() : undefined;
  } catch {
    return undefined;
  }
}

function elementReferences(el: Element): Reference[] {
  const follow = el.localName === "link";
  const refs: Reference[] = REFERENCE_ATTRS.flatMap((attr) => {
    const raw = el.getAttribute(attr)?.trim();
    return raw ? [{ raw, composition: false, follow }] : [];
  });
  for (const candidate of el.getAttribute("srcset")?.split(",") ?? []) {
    const raw = candidate.trim().split(/\s+/)[0];
    if (raw) refs.push({ raw, composition: false, follow: false });
  }
  const composition = el.getAttribute("data-composition-src")?.trim();
  if (composition) refs.push({ raw: composition, composition: true, follow: true });
  const lut = colorGradingLut(el.getAttribute(HF_COLOR_GRADING_ATTR));
  if (lut) refs.push({ raw: lut, composition: false, follow: false, colorGradingLut: true });
  return refs;
}

export function htmlReferences(html: string): Reference[] {
  const { document } = parseHTML(html);
  const hosts = document.querySelectorAll(
    `[src], [href], [poster], [xlink\\:href], [srcset], [data-composition-src], [${HF_COLOR_GRADING_ATTR}]`,
  );
  const refs = [...hosts].flatMap(elementReferences);
  for (const style of document.querySelectorAll("style")) {
    refs.push(...cssReferences(style.textContent ?? ""));
  }
  for (const el of document.querySelectorAll("[style]")) {
    refs.push(...cssReferences(el.getAttribute("style") ?? ""));
  }
  for (const template of document.querySelectorAll("template")) {
    refs.push(...htmlReferences(template.innerHTML));
  }
  return refs;
}

const WINDOWS_DEVICE_PREFIX = /^[\\/]{2}[?.][\\/]/;

function withoutQuery(raw: string): string {
  const device = WINDOWS_DEVICE_PREFIX.exec(raw)?.[0] ?? "";
  return device + raw.slice(device.length).replace(/[?#].*$/, "");
}

export function localPath(raw: string, fromDir: string): string | null {
  if (raw.startsWith("file:")) {
    try {
      return fileURLToPath(raw);
    } catch {
      return null;
    }
  }
  const path = withoutQuery(raw);
  if (isAbsolute(path) && !path.startsWith("//")) return path;
  if (path === "" || isNonRelativeUrl(path)) return null;
  try {
    return resolve(fromDir, decodeURIComponent(path));
  } catch {
    return resolve(fromDir, path);
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

export function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function readHead(file: string): { text: string; whole: boolean } | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = statSync(file).size;
    const buffer = Buffer.alloc(Math.min(size, MAX_SCANNED_BYTES));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return {
      text: buffer.toString("utf-8", 0, read),
      whole: size <= MAX_SCANNED_BYTES,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export const isPageOrStylesheet = (path: string) => /\.(?:html?|css)$/i.test(path);

// A composition resolves as the render compiler resolves it; one that leaves the project resolves as written.
export function referencePath(ref: Reference, file: string, projectDir: string): string | null {
  if (!ref.composition) return localPath(ref.raw, dirname(file));
  try {
    return resolveCompositionSrc(projectDir, ref.raw) ?? localPath(ref.raw, projectDir);
  } catch {
    return null;
  }
}

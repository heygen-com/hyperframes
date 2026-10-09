import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";

function getHtmlAttribute(element: Element, name: string): string | null {
  // linkedom preserves attribute spelling; HTML names are case-insensitive and
  // browsers keep the first occurrence when duplicate attributes are present.
  return (
    Array.from(element.attributes).find((attribute) => attribute.name.toLowerCase() === name)
      ?.value ?? null
  );
}

/**
 * Read a composition's declared frame rate from its root element's `data-fps`
 * attribute — the same attribute the runtime honors (core/runtime/init.ts) — so
 * `hyperframes render` can default to it instead of a hard-coded 30 when `--fps`
 * is not passed. Returns the raw attribute string (for the caller to validate
 * via `parseFps`, which supports fractional rates like `30000/1001`), or `null`
 * when no root `data-fps` is present.
 *
 * Root resolution mirrors the runtime: prefer an explicit
 * `[data-composition-id][data-root="true"]`, else the outermost
 * `[data-composition-id]` (one with no `[data-composition-id]` ancestor).
 */
export function readCompositionFps(html: string): string | null {
  let doc: Document;
  try {
    doc = parseHTML(html).document as unknown as Document;
  } catch {
    return null;
  }

  const compositions = Array.from(doc.querySelectorAll("*")).filter(
    (element) => getHtmlAttribute(element, "data-composition-id") !== null,
  );
  const root =
    compositions.find((element) => getHtmlAttribute(element, "data-root") === "true") ??
    compositions[0];

  const raw = root ? getHtmlAttribute(root, "data-fps")?.trim() : undefined;
  return raw ? raw : null;
}

/**
 * Cloud render backends (Lambda, Cloud Run) accept only an integer fps
 * from a small fixed allowed set (currently {24, 30, 60}) — unlike local
 * `render`, they can't take an arbitrary/fractional data-fps. Reads
 * `<projectDir>/index.html` and returns its declared data-fps as a number
 * ONLY when it parses to an integer AND is a member of `allowed`;
 * otherwise `null` so the caller keeps its own existing default (30).
 */
export function readAllowedCompositionFpsFromDir(
  projectDir: string,
  allowed: readonly number[],
): number | null {
  let html: string;
  try {
    html = readFileSync(join(projectDir, "index.html"), "utf8");
  } catch {
    return null;
  }
  const raw = readCompositionFps(html);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && allowed.includes(n) ? n : null;
}

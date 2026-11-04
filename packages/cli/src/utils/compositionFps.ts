import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DISTRIBUTED_FPS, type DistributedFps, isDistributedFps } from "@hyperframes/core";
import { parseHTML } from "linkedom";
import { c } from "../ui/colors.js";

function getHtmlAttribute(element: Element, name: string): string | null {
  // linkedom preserves spelling; HTML names match without case and keep the first duplicate.
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

const DEFAULT_CLOUD_FPS: DistributedFps = 30;

/**
 * Cloud render fps when `--fps` is not passed: `<projectDir>/index.html`'s
 * data-fps if it is in `DISTRIBUTED_FPS`, otherwise 30, with a warning when the
 * project declared a rate cloud renders cannot use.
 */
export function defaultCloudFps(projectDir: string): DistributedFps {
  let html: string;
  try {
    html = readFileSync(join(projectDir, "index.html"), "utf8");
  } catch {
    return DEFAULT_CLOUD_FPS;
  }
  const raw = readCompositionFps(html);
  if (raw == null) return DEFAULT_CLOUD_FPS;
  const n = Number(raw);
  if (isDistributedFps(n)) return n;
  console.warn(
    c.warn(
      `The composition declares data-fps="${raw}", which cloud renders do not support ` +
        `(${DISTRIBUTED_FPS.join(", ")}). Rendering at ${DEFAULT_CLOUD_FPS} fps; pass --fps to choose.`,
    ),
  );
  return DEFAULT_CLOUD_FPS;
}

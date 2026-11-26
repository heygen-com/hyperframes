import { RUNTIME_BOOTSTRAP_ATTR } from "@hyperframes/core/compiler";
import { findStartTags } from "@hyperframes/core/compiler/html-document";
import { isGsapCoreUrl } from "./gsapCoreScript.js";
import { IMPORT_MAP_TYPE } from "./rootImportMap.js";

export const TIMELINE_REGISTRY_SCRIPT =
  "<script>window.__timelines=window.__timelines||{};</script>";

const HANDLER_FRAME_TEMPLATE_OR_CHILD_COMPOSITION =
  /\son[a-z]+\s*=|<(iframe|frame|object|embed|template)\b|\sdata-composition-src\s*=/i;
const SCRIPT_SRC = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function isStudioOwnScript(html: string, start: number): boolean {
  if (html.startsWith(TIMELINE_REGISTRY_SCRIPT, start)) return true;
  const tag = html.slice(start, html.indexOf(">", start) + 1);
  if (tag.includes(RUNTIME_BOOTSTRAP_ATTR) || IMPORT_MAP_TYPE.test(tag)) return true;
  const src = SCRIPT_SRC.exec(tag);
  return src !== null && isGsapCoreUrl((src[1] ?? src[2] ?? src[3] ?? "").replace(/&amp;/gi, "&"));
}

// Code that could still register a timeline. Whatever is not known to be Studio's own counts, so unsure means held.
export function hasAuthoredCode(html: string): boolean {
  if (HANDLER_FRAME_TEMPLATE_OR_CHILD_COMPOSITION.test(html)) return true;
  return findStartTags(html, "script").some((start) => !isStudioOwnScript(html, start));
}

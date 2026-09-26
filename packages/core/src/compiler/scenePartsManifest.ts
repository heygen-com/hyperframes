import { createHash } from "node:crypto";
import { SCENE_PART_ATTR, SCENE_PARTS_META, type SceneParts } from "../sceneParts";
import { parseHTMLContent } from "./htmlDocument";

const hash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 16);

// One leading doctype, comment or tag, read past quoted values that can hold ">".
const LEADING_TAG_RE = /\s*(?:<!--[\s\S]*?-->|<(!?[\w-]*)(?:[^>"']|"[^"]*"|'[^']*')*>)/y;

/** Where the head's start tag ends, stepping over the doctype, comments and `<html>`; -1 without one. */
function headStartTagEnd(html: string): number {
  LEADING_TAG_RE.lastIndex = 0;
  for (let tag; (tag = LEADING_TAG_RE.exec(html)); ) {
    const name = tag[1]?.toLowerCase();
    if (name === "head") return LEADING_TAG_RE.lastIndex;
    if (name !== undefined && name !== "!doctype" && name !== "html") return -1;
  }
  return -1;
}

/**
 * Adds a {@link SceneParts} manifest so the runtime can tell a rebuild differs only inside scenes.
 * `ignore` lists selectors for parts that change on every build without changing what is shown.
 */
export function addScenePartsManifest(html: string, ignore: readonly string[] = []): string {
  const doc = parseHTMLContent(html);
  const parts = [...doc.querySelectorAll(`[${SCENE_PART_ATTR}]`)];
  if (parts.length === 0) return html;
  const byScene = new Map<string, string[]>();
  for (const el of parts) {
    const scene = el.getAttribute(SCENE_PART_ATTR) ?? "";
    byScene.set(scene, [...(byScene.get(scene) ?? []), el.outerHTML]);
  }
  // A marker keeps each part's place in `shared`, so moving or reordering a scene changes it.
  for (const el of parts)
    el.replaceWith(doc.createComment(`hf-scene:${el.getAttribute(SCENE_PART_ATTR)}`));
  for (const el of ignore.flatMap((sel) => [...doc.querySelectorAll(sel)])) el.remove();
  const manifest: SceneParts = {
    shared: hash(doc.toString()),
    scenes: Object.fromEntries([...byScene].map(([scene, html]) => [scene, hash(html.join("\n"))])),
  };
  const content = JSON.stringify(manifest).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const at = headStartTagEnd(html);
  if (at < 0) return html;
  return `${html.slice(0, at)}<meta name="${SCENE_PARTS_META}" content="${content}">${html.slice(at)}`;
}

import { createHash } from "node:crypto";
import { SCENE_PART_ATTR, SCENE_PARTS_META, type SceneParts } from "../sceneParts";
import { parseHTMLContent } from "./htmlDocument";

const hash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * Add a {@link SceneParts} manifest to a preview document built with `sceneParts`, so the preview
 * runtime can tell whether a rebuilt document differs only inside some scenes. `ignore` lists
 * selectors for parts that change on every build without changing what is shown.
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
  for (const el of [...parts, ...ignore.flatMap((sel) => [...doc.querySelectorAll(sel)])]) {
    el.remove();
  }
  const manifest: SceneParts = {
    shared: hash(doc.toString()),
    scenes: Object.fromEntries([...byScene].map(([scene, html]) => [scene, hash(html.join("\n"))])),
  };
  const content = JSON.stringify(manifest).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return html.replace(
    /<head(\s[^>]*)?>/i,
    (head) => `${head}<meta name="${SCENE_PARTS_META}" content="${content}">`,
  );
}

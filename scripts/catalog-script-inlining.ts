/** Inlines 3D-motion items' local scripts into their docs payload: the docs host's allowlist
 * (fonts/png/svg/json, hive/hfoss.md) 404s .js/.mjs/.hdr as hosted files. */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RegistryItem } from "../packages/core/src/index.js";
import { hostedUrlByReference } from "./registry-hosted-assets.ts";

interface VendorFile {
  /** Stable key used both as the JSON filename and the import-map value lookup. */
  key: string;
  /** repoRoot-relative path to read the canonical bytes from. */
  canonicalPath: string;
  /** Other repoRoot-relative copies expected byte-identical to the canonical one. */
  otherCopies: string[];
}

const VENDOR_FILES: VendorFile[] = [
  {
    key: "gsap-3.14.2.min",
    canonicalPath: "registry/blocks/frost-sequence-camera-orbit/assets/gsap-3.14.2.min.js",
    otherCopies: [
      "registry/blocks/cuboid-carousel/assets/gsap-3.14.2.min.js",
      "registry/blocks/orbit-card/assets/gsap-3.14.2.min.js",
      "registry/blocks/code-slice-hero/assets/gsap-3.14.2.min.js",
    ],
  },
  {
    key: "three.module.min",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/three.module.min.js",
    otherCopies: ["registry/blocks/orbit-card/assets/three.module.min.js"],
  },
  {
    key: "three.core.min",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/three.core.min.js",
    otherCopies: ["registry/blocks/orbit-card/assets/three.core.min.js"],
  },
  {
    key: "RoomEnvironment",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/addons/environments/RoomEnvironment.js",
    otherCopies: [],
  },
  {
    key: "BufferGeometryUtils",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/addons/utils/BufferGeometryUtils.js",
    otherCopies: [],
  },
];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Writes each shared vendor library once as a `.json` file, returning key -> URL.
 * Hashes each consumer's copy against the canonical one first to catch a divergent library. */
export function writeSharedVendorScripts(
  repoRoot: string,
  payloadRoot: string,
): Record<string, string> {
  const vendorDir = join(payloadRoot, "vendor");
  mkdirSync(vendorDir, { recursive: true });
  const urls: Record<string, string> = {};
  for (const file of VENDOR_FILES) {
    const bytes = readFileSync(join(repoRoot, file.canonicalPath));
    const hash = sha256(bytes);
    for (const other of file.otherCopies) {
      const otherHash = sha256(readFileSync(join(repoRoot, other)));
      if (otherHash !== hash) {
        throw new Error(
          `catalog-script-inlining: ${file.canonicalPath} and ${other} are both named as the ` +
            `same shared vendor library "${file.key}" but are not byte-identical.`,
        );
      }
    }
    writeFileSync(
      join(vendorDir, `${file.key}.json`),
      JSON.stringify({ text: bytes.toString("utf-8") }),
    );
    urls[file.key] = `/public/catalog/vendor/${file.key}.json`;
  }
  return urls;
}

/** A JS string literal safe to embed inside a `<script>` body. */
function jsStringLiteral(text: string): string {
  return JSON.stringify(text).replace(/<\/script/gi, "<\\/script");
}

/** Looks up a vendor URL by key, throwing rather than silently generating a broken fetch. */
function vendorUrl(vendorUrls: Record<string, string>, key: string): string {
  const url = vendorUrls[key];
  if (!url) throw new Error(`catalog-script-inlining: no vendor URL registered for "${key}".`);
  return url;
}

/** Expression that fetches a vendor JSON and resolves to a blob URL for it. */
function vendorFetchExpr(url: string): string {
  return `${vendorTextExpr(url)}.then(text=>${blobUrlExpr("text")})`;
}

/** Expression that fetches a vendor JSON and resolves to its raw text. */
function vendorTextExpr(url: string): string {
  return `fetch(${JSON.stringify(url)}).then(r=>r.json()).then(j=>j.text)`;
}

/** Expression wrapping a text-valued expression into a `text/javascript` blob URL. */
function blobUrlExpr(textExpr: string): string {
  return `URL.createObjectURL(new Blob([${textExpr}],{type:"text/javascript"}))`;
}

/** JS statements (inside an async bootstrap) that load gsap as a classic script after `selfScript`. */
function gsapLoaderJs(vendorUrls: Record<string, string>): string {
  return `const gsapUrl=await ${vendorFetchExpr(vendorUrl(vendorUrls, "gsap-3.14.2.min"))};
await new Promise((res,rej)=>{const s=document.createElement("script");s.src=gsapUrl;s.onload=res;s.onerror=rej;selfScript.after(s);});`;
}

/** JS statements defining `threeModuleUrl`, with three.module's relative three.core import patched. */
function threeModuleUrlJs(vendorUrls: Record<string, string>): string {
  return `const threeCoreUrl=await ${vendorFetchExpr(vendorUrl(vendorUrls, "three.core.min"))};
const threeModuleText=(await ${vendorTextExpr(vendorUrl(vendorUrls, "three.module.min"))}).split('"./three.core.min.js"').join(JSON.stringify(threeCoreUrl));
const threeModuleUrl=${blobUrlExpr("threeModuleText")};`;
}

function replaceOnce(html: string, needle: string, replacement: string, label: string): string {
  if (!html.includes(needle)) {
    throw new Error(`catalog-script-inlining: expected to find ${label} in the composition HTML.`);
  }
  return html.replace(needle, () => replacement);
}

/** Pulls every bare `<script>` tag before `stopBefore` out of `html`, in order. Document order
 * alone doesn't guarantee these run before an async bootstrap's dynamic module (measured). */
function extractPrecedingClassicScripts(
  html: string,
  stopBefore: RegExp,
): { texts: string[]; html: string } {
  const stopMatch = stopBefore.exec(html);
  if (!stopMatch) {
    throw new Error(
      "catalog-script-inlining: stop marker not found while collecting preceding scripts.",
    );
  }
  const prefix = html.slice(0, stopMatch.index);
  const rest = html.slice(stopMatch.index);
  const texts = [...prefix.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
  const newPrefix = prefix.replace(/<script>[\s\S]*?<\/script>/g, "");
  return { texts, html: newPrefix + rest };
}

/** Pull the body of the first script tag matching `openTag` out of `html`, and remove it. */
function extractAndRemoveScript(
  html: string,
  openTag: RegExp,
  label: string,
): { text: string; html: string } {
  const match = openTag.exec(html);
  if (!match)
    throw new Error(`catalog-script-inlining: expected to find ${label} in the composition HTML.`);
  const contentStart = match.index + match[0].length;
  const closeIdx = html.indexOf("</script>", contentStart);
  if (closeIdx === -1)
    throw new Error(`catalog-script-inlining: ${label} has no closing </script>.`);
  return {
    text: html.slice(contentStart, closeIdx),
    html: html.slice(0, match.index) + html.slice(closeIdx + "</script>".length),
  };
}

/** Script text loads hosted assets by their local name, and the payload has no such file: point
 * each at its CDN URL. `assetCall` is the bundle's base-joining helper, which takes the name
 * relative to `assets/`. Throws when a name is still there, so a rebuild that renames things fails loudly. */
function withHostedRef(text: string, ref: string, url: string, assetCall?: string): string {
  const bare = ref.replace(/^assets\//, "");
  let out = text.split(`"${ref}"`).join(`"${url}"`);
  if (assetCall) out = out.split(`${assetCall}("${bare}")`).join(`"${url}"`);
  if (bare !== ref && out.includes(`"${bare}"`)) {
    throw new Error(`catalog-script-inlining: "${ref}" is still loaded by its local name.`);
  }
  return out;
}

export function withHostedRefs(text: string, projectDir: string, assetCall?: string): string {
  const manifest = JSON.parse(
    readFileSync(join(projectDir, "registry-item.json"), "utf-8"),
  ) as RegistryItem;
  let out = text;
  for (const [ref, url] of hostedUrlByReference(manifest)) {
    out = withHostedRef(out, ref, url, assetCall);
  }
  return out;
}

function inlineFrostScripts(
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
): string {
  const frostText = withHostedRefs(
    readFileSync(join(projectDir, "assets/frost.js"), "utf-8"),
    projectDir,
    "a2",
  );

  // Moves the composition's own inline script into the same async chain, after
  // gsap/frost.js load: left in document order it would run before either is ready.
  const { text: compositionScriptText, html: withoutComposition } = extractAndRemoveScript(
    html.replace(`<script src="assets/gsap-3.14.2.min.js"></script>`, "__CATALOG_BOOTSTRAP__"),
    /<script>(?=[\s\S]*?window\.__frostInstance)/,
    "frost's composition script",
  );

  const bootstrap = `<script>(function(){
const selfScript=document.currentScript;
(async()=>{
${gsapLoaderJs(vendorUrls)}
(0,eval)(${jsStringLiteral(frostText)});
(0,eval)(${jsStringLiteral(compositionScriptText)});
})();
})();</script>`;
  return replaceOnce(
    withoutComposition.replace("__CATALOG_BOOTSTRAP__", () => bootstrap),
    `<script src="assets/frost.js"></script>`,
    "",
    "frost.js script tag",
  );
}

function inlineGlassScripts(html: string, projectDir: string): string {
  const hdrRelPath = "assets/ferndale_studio_01_1k.hdr";
  let glassText = withHostedRefs(
    readFileSync(join(projectDir, "assets/glass-main.js"), "utf-8"),
    projectDir,
  );
  if (!glassText.includes(hdrRelPath)) {
    throw new Error(
      `catalog-script-inlining: glass-main.js no longer references "${hdrRelPath}"; ` +
        `the hdr substitution needs updating.`,
    );
  }
  const hdrBytes = readFileSync(join(projectDir, hdrRelPath));
  const hdrDataUrl = `data:application/octet-stream;base64,${hdrBytes.toString("base64")}`;
  glassText = glassText.split(hdrRelPath).join(hdrDataUrl);

  const bootstrap = `<script>(0,eval)(${jsStringLiteral(glassText)});</script>`;
  return replaceOnce(
    html,
    `<script src="assets/glass-main.js"></script>`,
    bootstrap,
    "glass-main.js script tag",
  );
}

function inlineCuboidScripts(
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
): string {
  const cuboidMotionText = readFileSync(join(projectDir, "assets/cuboid-motion.js"), "utf-8");
  const gsapImportmapRe =
    /<script src="assets\/gsap-3\.14\.2\.min\.js"><\/script>\s*<script type="importmap">[\s\S]*?<\/script>/;
  if (!gsapImportmapRe.test(html)) {
    throw new Error("catalog-script-inlining: cuboid-carousel's gsap/importmap block not found.");
  }
  const { texts: precedingScripts, html: withoutPreceding } = extractPrecedingClassicScripts(
    html.replace(gsapImportmapRe, "__CATALOG_BOOTSTRAP__"),
    /<script type="module">/,
  );
  const { text: entryModuleText, html: withoutEntry } = extractAndRemoveScript(
    withoutPreceding,
    /<script type="module">/,
    "cuboid-carousel's entry module script",
  );
  const precedingScriptEvals = precedingScripts
    .map((text) => `(0,eval)(${jsStringLiteral(text)});`)
    .join("\n");

  const bootstrap = `<script>(function(){
const selfScript=document.currentScript;
(async()=>{
${gsapLoaderJs(vendorUrls)}
// Blob URLs aren't hierarchical, so three.module's relative import of three.core can't
// resolve via import-map "scopes" (unreliable for blob-URL keys here); patch it directly.
${threeModuleUrlJs(vendorUrls)}
const roomEnvUrl=await ${vendorFetchExpr(vendorUrl(vendorUrls, "RoomEnvironment"))};
const bufferGeoUrl=await ${vendorFetchExpr(vendorUrl(vendorUrls, "BufferGeometryUtils"))};
const cuboidMotionUrl=${blobUrlExpr(jsStringLiteral(cuboidMotionText))};
const im=document.createElement("script");
im.type="importmap";
im.textContent=JSON.stringify({imports:{three:threeModuleUrl,"three/addons/environments/RoomEnvironment.js":roomEnvUrl,"three/addons/utils/BufferGeometryUtils.js":bufferGeoUrl,"./assets/cuboid-motion.js":cuboidMotionUrl}});
selfScript.after(im);
${precedingScriptEvals}
const entry=document.createElement("script");
entry.type="module";
entry.textContent=${jsStringLiteral(entryModuleText)};
im.after(entry);
})();
})();</script>`;
  return withoutEntry.replace("__CATALOG_BOOTSTRAP__", () => bootstrap);
}

function inlineOrbitScripts(
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
): string {
  const orbitSceneText = readFileSync(join(projectDir, "assets/orbit-scene.js"), "utf-8");
  const orbitMotionText = readFileSync(join(projectDir, "assets/orbit-motion.js"), "utf-8");
  const gsapRe = /<script src="assets\/gsap-3\.14\.2\.min\.js"><\/script>/;
  if (!gsapRe.test(html)) {
    throw new Error("catalog-script-inlining: orbit-card's gsap script tag not found.");
  }
  const { text: entryModuleText, html: withoutEntry } = extractAndRemoveScript(
    html.replace(gsapRe, "__CATALOG_BOOTSTRAP__"),
    /<script type="module">/,
    "orbit-card's entry module script",
  );

  const bootstrap = `<script>(function(){
const selfScript=document.currentScript;
(async()=>{
${gsapLoaderJs(vendorUrls)}
// Same blob-URL specifier patch as inlineCuboidScripts (blob URLs aren't hierarchical).
${threeModuleUrlJs(vendorUrls)}
const orbitMotionUrl=${blobUrlExpr(jsStringLiteral(orbitMotionText))};
const orbitSceneText=${jsStringLiteral(orbitSceneText)}.split('"./three.module.min.js"').join(JSON.stringify(threeModuleUrl)).split('"./orbit-motion.js"').join(JSON.stringify(orbitMotionUrl));
const orbitSceneUrl=${blobUrlExpr("orbitSceneText")};
const im=document.createElement("script");
im.type="importmap";
im.textContent=JSON.stringify({imports:{"./assets/orbit-scene.js":orbitSceneUrl}});
selfScript.after(im);
const entry=document.createElement("script");
entry.type="module";
entry.textContent=${jsStringLiteral(entryModuleText)};
im.after(entry);
})();
})();</script>`;
  return withoutEntry.replace("__CATALOG_BOOTSTRAP__", () => bootstrap);
}

function inlineCodeSliceScripts(
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
): string {
  const localNames = ["shadows.js", "surface.js"];
  const localScripts = localNames.map((name) => readFileSync(join(projectDir, name), "utf-8"));
  let out = replaceOnce(
    html,
    `<script src="assets/gsap-3.14.2.min.js"></script>`,
    "__CATALOG_BOOTSTRAP__",
    "code-slice-hero's gsap script tag",
  );
  for (const name of localNames) {
    out = replaceOnce(out, `<script src="${name}"></script>`, "", `${name} script tag`);
  }
  const { text: compositionText, html: withoutComposition } = extractAndRemoveScript(
    out,
    /<script>/,
    "code-slice-hero's composition script",
  );
  const evals = [...localScripts, compositionText]
    .map((text) => `(0,eval)(${jsStringLiteral(text)});`)
    .join("\n");
  const bootstrap = `<script>(function(){
const selfScript=document.currentScript;
(async()=>{
${gsapLoaderJs(vendorUrls)}
${evals}
})();
})();</script>`;
  return withoutComposition.replace("__CATALOG_BOOTSTRAP__", () => bootstrap);
}

type ScriptInliner = (
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
) => string;

const SCRIPT_INLINERS: Record<string, ScriptInliner> = {
  "frost-sequence-camera-orbit": inlineFrostScripts,
  "glass-shard-title": inlineGlassScripts,
  "cuboid-carousel": inlineCuboidScripts,
  "orbit-card": inlineOrbitScripts,
  "code-slice-hero": inlineCodeSliceScripts,
};

export function needsScriptInlining(itemName: string): boolean {
  return itemName in SCRIPT_INLINERS;
}

/** Replaces an item's unreachable script tags with inline/vendor-blob equivalents; a no-op
 * for items outside SCRIPT_INLINERS. */
export function inlineCatalogScripts(
  itemName: string,
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
): string {
  const inline = SCRIPT_INLINERS[itemName];
  return inline ? inline(html, projectDir, vendorUrls) : html;
}

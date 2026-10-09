/** Inlines 3D-motion items' local scripts into their docs payload: the docs host's allowlist
 * (fonts/png/svg/json) 404s .js/.mjs/.hdr as hosted files, and its CSP runs
 * inline scripts but no blob: script, so every library runs as an inline <script>. */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import type { RegistryItem } from "../packages/core/src/index.js";
import { hostedUrlByReference } from "./registry-hosted-assets.ts";

interface VendorFile {
  /** Stable key used as the vendor JSON filename and bootstrap lookup. */
  key: string;
  /** repoRoot-relative path to read the canonical bytes from. */
  canonicalPath: string;
  /** Other repoRoot-relative copies expected byte-identical to the canonical one. */
  otherCopies: string[];
  /** An ES module, bundled into SHARED_MODULES_KEY under `specifier` (or only reached through another). */
  module?: { specifier?: string };
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
    module: { specifier: "three" },
  },
  {
    key: "three.core.min",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/three.core.min.js",
    otherCopies: ["registry/blocks/orbit-card/assets/three.core.min.js"],
    module: {},
  },
  {
    key: "RoomEnvironment",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/addons/environments/RoomEnvironment.js",
    otherCopies: [],
    module: { specifier: "three/addons/environments/RoomEnvironment.js" },
  },
  {
    key: "BufferGeometryUtils",
    canonicalPath: "registry/blocks/cuboid-carousel/assets/addons/utils/BufferGeometryUtils.js",
    otherCopies: [],
    module: { specifier: "three/addons/utils/BufferGeometryUtils.js" },
  },
];

const GSAP_KEY = "gsap-3.14.2.min";
const SHARED_MODULES_KEY = "three-modules";
const SHARED_MODULES_GLOBAL = "__hfCatalogModules";
/** Import specifiers an item's own modules take from the shared bundle, and the names they use for them. */
const SHARED_SPECIFIERS = ["three", "three/addons/*", "./three.module.min.js"];
const SHARED_ALIASES: Record<string, string> = { "./three.module.min.js": "three" };

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Writes gsap and the shared ES-module bundle once each as a `.json` file, returning key -> URL.
 * Hashes each consumer's copy against the canonical one first to catch a divergent library. */
export function writeSharedVendorScripts(
  repoRoot: string,
  payloadRoot: string,
): Record<string, string> {
  const vendorDir = join(payloadRoot, "vendor");
  mkdirSync(vendorDir, { recursive: true });
  const urls: Record<string, string> = {};
  const write = (key: string, text: string) => {
    writeFileSync(join(vendorDir, `${key}.json`), JSON.stringify({ text }));
    urls[key] = `/public/catalog/vendor/${key}.json`;
  };
  for (const file of VENDOR_FILES) {
    const bytes = canonicalBytes(repoRoot, file);
    if (!file.module) write(file.key, bytes.toString("utf-8"));
  }
  write(SHARED_MODULES_KEY, sharedModulesBundle(repoRoot));
  return urls;
}

function canonicalBytes(repoRoot: string, file: VendorFile): Buffer {
  const bytes = readFileSync(join(repoRoot, file.canonicalPath));
  const divergent = file.otherCopies.find(
    (other) => sha256(readFileSync(join(repoRoot, other))) !== sha256(bytes),
  );
  if (divergent) {
    throw new Error(
      `catalog-script-inlining: ${file.canonicalPath} and ${divergent} are both named as the ` +
        `same shared vendor library "${file.key}" but are not byte-identical.`,
    );
  }
  return bytes;
}

/** One classic script defining SHARED_MODULES_GLOBAL: every shared ES module by its import specifier. */
export function sharedModulesBundle(repoRoot: string): string {
  const named = VENDOR_FILES.filter((file) => file.module?.specifier);
  const entry = [
    ...named.map((file, i) => `import * as m${i} from "./${file.canonicalPath}";`),
    `globalThis.${SHARED_MODULES_GLOBAL}={${named.map((file, i) => `${JSON.stringify(file.module?.specifier)}:m${i}`).join(",")}};`,
  ].join("\n");
  const three = named.find((file) => file.module?.specifier === "three");
  return classicBundle(entry, repoRoot, { three: `./${three?.canonicalPath}` }, []);
}

/** `entry` and the modules it imports as one classic script. SHARED_SPECIFIERS stay out of it and are
 * read from the shared bundle, through the `require` esbuild emits for an external import. */
function classicBundle(
  entry: string,
  workingDir: string,
  alias: Record<string, string>,
  external = SHARED_SPECIFIERS,
): string {
  const { outputFiles } = buildSync({
    stdin: { contents: entry, resolveDir: resolve(workingDir), loader: "js" },
    absWorkingDir: resolve(workingDir),
    bundle: true,
    format: "iife",
    write: false,
    alias,
    external,
    legalComments: "none",
    logLevel: "silent",
  });
  const code = outputFiles[0]?.text;
  if (!code) throw new Error("catalog-script-inlining: esbuild produced no output.");
  if (external.length === 0) return `"use strict";${code}`;
  const shared = `(s)=>globalThis.${SHARED_MODULES_GLOBAL}[${jsLiteral(SHARED_ALIASES)}[s]??s]`;
  return `(function(require){"use strict";${code}})(${shared});`;
}

/** A JSON literal safe to embed inside a `<script>` body. */
function jsLiteral(value: string | Readonly<Record<string, string>>): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** Looks up a vendor URL by key, throwing rather than silently generating a broken fetch. */
function vendorUrl(vendorUrls: Record<string, string>, key: string): string {
  const url = vendorUrls[key];
  if (!url) throw new Error(`catalog-script-inlining: no vendor URL registered for "${key}".`);
  return url;
}

/** A step running a vendor library: `vendor(url)` fetches its text and `run` executes it inline. */
function vendorStep(vendorUrls: Record<string, string>, key: string): string {
  return `run(await vendor(${JSON.stringify(vendorUrl(vendorUrls, key))}),${JSON.stringify(`${key}.js`)});`;
}

/** A step running `code`, inlined into the payload, under `name` in stack traces. */
function codeStep(code: string, name: string): string {
  return `run(${jsLiteral(code)},${JSON.stringify(name)});`;
}

/** One bootstrap `<script>` running `steps` in order, each piece as its own inline <script> so an error
 * keeps a real source; a failed fetch is logged against the item instead of rejecting silently. */
function bootstrapScript(item: string, steps: string[]): string {
  return `<script>(function(){
const vendor=(url)=>fetch(url).then((r)=>r.json()).then((j)=>j.text);
const run=(code,name)=>{const s=document.createElement("script");s.text=code+"\\n//# sourceURL=hyperframes-catalog://${item}/"+name;document.head.append(s);};
(async()=>{
${steps.join("\n")}
})().catch((error)=>console.error("[HyperFrames catalog] ${item} could not load its scripts",error));
})();</script>`;
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
    /<script>(?=(?:(?!<\/script>)[\s\S])*?window\.__frostInstance)/,
    "frost's composition script",
  );

  const bootstrap = bootstrapScript("frost-sequence-camera-orbit", [
    vendorStep(vendorUrls, GSAP_KEY),
    codeStep(frostText, "frost.js"),
    codeStep(compositionScriptText, "composition.js"),
  ]);
  return replaceOnce(
    withoutComposition.replace("__CATALOG_BOOTSTRAP__", () => bootstrap),
    `<script src="assets/frost.js"></script>`,
    "",
    "frost.js script tag",
  );
}

function inlineGlassScripts(html: string, projectDir: string): string {
  if (html.includes("assets/ferndale_studio_01_1k.hdr")) {
    throw new Error("catalog-script-inlining: glass-shard-title's hdr <link> was not inlined.");
  }
  const glassText = readFileSync(join(projectDir, "assets/glass-main.js"), "utf-8");
  const bootstrap = `<script>(0,eval)(${jsLiteral(glassText)});</script>`;
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
  const bootstrap = bootstrapScript("cuboid-carousel", [
    vendorStep(vendorUrls, GSAP_KEY),
    vendorStep(vendorUrls, SHARED_MODULES_KEY),
    ...precedingScripts.map((text, i) => codeStep(text, `script-${i + 1}.js`)),
    codeStep(
      classicBundle(entryModuleText, projectDir, {
        "cuboid-carousel/motion": "./assets/cuboid-motion.js",
      }),
      "entry.js",
    ),
  ]);
  return withoutEntry.replace("__CATALOG_BOOTSTRAP__", () => bootstrap);
}

function inlineOrbitScripts(
  html: string,
  projectDir: string,
  vendorUrls: Record<string, string>,
): string {
  const gsapRe = /<script src="assets\/gsap-3\.14\.2\.min\.js"><\/script>/;
  if (!gsapRe.test(html)) {
    throw new Error("catalog-script-inlining: orbit-card's gsap script tag not found.");
  }
  // The classic bundle replaces the import map, whose targets are unhosted files.
  const { html: withoutImportmap } = extractAndRemoveScript(
    html,
    /<script type="importmap">/,
    "orbit-card's import map",
  );
  const { text: entryModuleText, html: withoutEntry } = extractAndRemoveScript(
    withoutImportmap.replace(gsapRe, "__CATALOG_BOOTSTRAP__"),
    /<script type="module">/,
    "orbit-card's entry module script",
  );

  const bootstrap = bootstrapScript("orbit-card", [
    vendorStep(vendorUrls, GSAP_KEY),
    vendorStep(vendorUrls, SHARED_MODULES_KEY),
    codeStep(
      classicBundle(entryModuleText, projectDir, { "orbit-card/scene": "./assets/orbit-scene.js" }),
      "entry.js",
    ),
  ]);
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
  const bootstrap = bootstrapScript("code-slice-hero", [
    vendorStep(vendorUrls, GSAP_KEY),
    ...localScripts.map((text, i) => codeStep(text, localNames[i] ?? "script.js")),
    codeStep(compositionText, "composition.js"),
  ]);
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

/** Replaces an item's unreachable script tags with inline equivalents; a no-op
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

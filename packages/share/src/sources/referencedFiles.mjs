// @ts-check
import { createHash } from "node:crypto";
import { decodeTextHonoringBom } from "@hyperframes/parsers/asset-resolution";
import { mountedAsset } from "./variableAssets.mjs";
import { collectAssetReferences } from "./assetReferences.mjs";

/** @typedef {import("./types.js").Found} Found @typedef {import("./types.js").Walk} Walk */
const PROJECT = "https://project.invalid";
const sourcePath = /\.(?:html?|svg|css|[cm]?js)$/i;
const scriptPath = /\.[cm]?js$/i;
const maxSourceBytes = 16 * 1024 * 1024;
const maxGraphBytes = 64 * 1024 * 1024;
const maxReferences = 100_000;
/** Script references use either the module URL or the importing document's base URL. */
const importingDocument = new URL("https://document.invalid");

/** @param {string} path */
const urlOf = (path) => new URL(path.split("/").map(encodeURIComponent).join("/"), PROJECT);

/** Resolve against the inventory of regular, portable files; a reference never grants filesystem access.
 * @param {string} raw @param {URL} base @param {ReadonlyMap<string, Found>} files
 * @param {Walk["directoryEntries"]} directories */
function referencedPath(raw, base, files, directories, allowFallback = true) {
  const value = raw.trim();
  if (!value || /^(?:[?#]|[a-z][a-z\d+.-]*:|[/\\]{2})/i.test(value)) return null;
  try {
    const url = new URL(value, base);
    if (url.origin !== PROJECT || /%2f|%5c/i.test(url.pathname)) return null;
    const path = decodeURIComponent(url.pathname.slice(1));
    if (files.has(path)) return path;
    return allowFallback ? rootFallback(value, base, files, path, directories) : null;
  } catch {
    /* A malformed or external URL cannot name an inventory entry. */
  }
  return null;
}

/** A nested composition can fall back to the root only when its sibling is missing. An entry
 * skipped during capture, including a symlink or pruned directory, shadows the root candidate.
 * @param {string} value @param {URL} base @param {ReadonlyMap<string, Found>} files
 * @param {string} sibling @param {Walk["directoryEntries"]} directories */
function rootFallback(value, base, files, sibling, directories) {
  if (!/\.html?$/i.test(base.pathname) || /^(?:\.{1,2}\/|\/)/.test(value)) return null;
  let directory = "";
  for (const name of sibling.split("/")) {
    const entries = directories.get(directory);
    if (!entries) return null;
    if (!entries.has(name)) {
      const path = decodeURIComponent(new URL(value, PROJECT).pathname.slice(1));
      return files.has(path) ? path : null;
    }
    directory = directory ? directory + "/" + name : name;
  }
  return null;
}

/** @param {string} root @param {Found} file @param {typeof import("./capture.mjs").openListed} openListed */
async function readSource(root, file, openListed) {
  if (file.size > maxSourceBytes) throw new Error("Dependency source exceeds the scan limit");
  const handle = await openListed(root, file);
  if (!handle) return null;
  try {
    // Bound the read even if another process grows the file after it was opened.
    const bytes = Buffer.alloc(file.size);
    let at = 0;
    while (at < bytes.length) {
      const { bytesRead } = await handle.read(bytes, at, bytes.length - at, at);
      if (!bytesRead) return null;
      at += bytesRead;
    }
    const after = await handle.stat();
    if (after.mtimeMs !== file.mtimeMs || after.size !== file.size) return null;
    return bytes;
  } finally {
    await handle.close();
  }
}

/** @typedef {import("./assetReferences.mjs").Host & { ordinal: number }} Mount
 * @typedef {{ value: string, base: URL, mount?: Mount }} AssetReference
 * @typedef {{ references: AssetReference[], html: ReturnType<typeof collectAssetReferences> }} Scanned */

/** @param {string} root @param {typeof import("./capture.mjs").openListed} openListed
 * @param {Map<string, string>} hashes */
function referenceReader(root, openListed, hashes) {
  /** @type {Map<string, Scanned>} */
  const cache = new Map();
  let bytesRemaining = maxGraphBytes;
  let referencesRemaining = maxReferences;
  /** @param {Found} file @returns {Promise<Scanned | null>} */
  return async function referencesFor(file) {
    const cached = cache.get(file.path);
    if (cached) return cached;
    bytesRemaining -= file.size;
    if (bytesRemaining < 0) throw new Error("Project dependency sources exceed the scan limit");
    const bytes = await readSource(root, file, openListed);
    if (!bytes) return null;
    /** @type {AssetReference[]} */
    const references = [];
    const html = collectAssetReferences(
      file.path,
      decodeTextHonoringBom(bytes),
      urlOf(file.path),
      importingDocument,
      (value, base, host) => {
        if (--referencesRemaining < 0)
          throw new Error("Project dependency references exceed the scan limit");
        references.push({
          value,
          base,
          ...(host && { mount: { ...host, ordinal: referencesRemaining } }),
        });
      },
    );
    hashes.set(file.path, createHash("sha256").update(bytes).digest("hex"));
    const scanned = { references, html };
    cache.set(file.path, scanned);
    return scanned;
  };
}

/** @param {AssetReference[]} references @param {Found} file @param {URL} documentUrl
 * @param {Map<string, Found>} inventory @param {Walk["directoryEntries"]} directories
 * @param {{ edges: number, urlCharacters: number }} remaining */
function* targets(references, file, documentUrl, inventory, directories, remaining) {
  remaining.edges -= references.length;
  if (remaining.edges < 0) throw new Error("Project dependency graph exceeds the scan limit");
  for (const { value, base, mount } of references) {
    const context = base === importingDocument ? documentUrl : base;
    remaining.urlCharacters -= value.length + context.href.length;
    if (remaining.urlCharacters < 0)
      throw new Error("Dependency URL resolution exceeds the scan limit");
    const path = referencedPath(value, context, inventory, directories);
    if (path)
      yield { path, mount, documentUrl: /\.html?$/i.test(file.path) ? context : documentUrl };
  }
}

/** @param {Scanned} scanned @param {Mount|undefined} mount @param {URL} base
 * @param {{edges:number,urlCharacters:number}} remaining @param {Map<string,Found>} inventory @param {Walk["directoryEntries"]} dirs */
function* mountedTargets(scanned, mount, base, remaining, inventory, dirs) {
  if (!mount || !scanned.html?.mediaSlots) return;
  for (const [id, value] of Object.entries(mount.values)) {
    if (--remaining.edges < 0) throw new Error("Project dependency graph exceeds the scan limit");
    const raw = mountedAsset(scanned.html.mediaSlots, mount.id, id, value);
    if (!raw) continue;
    remaining.urlCharacters -= raw.length + base.href.length;
    if (remaining.urlCharacters < 0)
      throw new Error("Dependency URL resolution exceeds the scan limit");
    const path = referencedPath(raw, base, inventory, dirs, false);
    if (path) yield path;
  }
}

/** Keep reachable hidden dependencies and the hashes of the exact bytes used for discovery.
 * @param {string} root @param {Walk} walk @param {typeof import("./capture.mjs").openListed} openListed */
export async function retainReferencedFiles(root, walk, openListed) {
  /** @type {Map<string, string>} */
  const hashes = new Map();
  if (!walk.files.some((file) => file.include_hidden)) return hashes;
  const inventory = new Map(walk.files.map((file) => [file.path, file]));
  const needed = new Set();
  const queued = new Set();
  /** @type {{ file: Found, documentUrl: URL, mount?: Mount, pageBase?: URL }[]} */
  const pending = [];
  const remaining = { edges: maxReferences, urlCharacters: maxGraphBytes };

  /** @param {string} path @param {URL} documentUrl @param {Mount} [mount] @param {URL} [pageBase] */
  function enqueue(path, documentUrl, mount, pageBase) {
    const file = inventory.get(path);
    if (!file) return;
    needed.add(path);
    if (!sourcePath.test(path)) return;
    const key = mount
      ? JSON.stringify([path, mount.ordinal, pageBase?.href])
      : scriptPath.test(path)
        ? JSON.stringify([path, documentUrl.href])
        : path;
    if (queued.has(key)) return;
    queued.add(key);
    pending.push({ file, documentUrl, mount, pageBase });
  }

  const referencesFor = referenceReader(root, openListed, hashes);

  enqueue("index.html", urlOf("index.html"));
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { file, documentUrl } = next;
    try {
      const scanned = await referencesFor(file);
      if (!scanned) {
        walk.problems.push({ path: file.path, problem: "changed" });
        break;
      }
      const pageBase = next.pageBase ?? scanned.html?.base ?? documentUrl;
      for (const path of mountedTargets(
        scanned,
        next.mount,
        pageBase,
        remaining,
        inventory,
        walk.directoryEntries,
      ))
        enqueue(path, pageBase);
      for (const target of targets(
        scanned.references,
        file,
        documentUrl,
        inventory,
        walk.directoryEntries,
        remaining,
      ))
        enqueue(target.path, target.documentUrl, target.mount, target.mount && pageBase);
    } catch {
      walk.problems.push({ path: file.path, problem: "unreadable" });
      break;
    }
  }
  walk.files = walk.files.filter((file) => !file.include_hidden || needed.has(file.path));
  return hashes;
}

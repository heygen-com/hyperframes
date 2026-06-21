// transition-registry.mjs — loader for this skill's vendored transition registry
// (./transitions.json). The registry is the curated Tier-B subset (transform /
// opacity / filter on the two frame clip wrappers `#el-<id>`, no overlay DOM) +
// each type's GSAP template. Vendored into the skill so it ships standalone; the
// recipes originate from the shared catalog skills/hyperframes-animation/
// transitions/ (css-*.md) — keep them in step if those shared recipes change.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REGISTRY_PATH = resolve(here, "./transitions.json");

let _cache = null;

export function loadTransitionRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  if (_cache && _cache.path === registryPath) return _cache.data;
  let data;
  try {
    data = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (e) {
    throw new Error(`transition registry not loadable at ${registryPath}: ${e.message}`);
  }
  if (!Array.isArray(data.transitions) || data.transitions.length === 0) {
    throw new Error(`transition registry ${registryPath} has no transitions[]`);
  }
  _cache = { path: registryPath, data };
  return data;
}

// Convenience: a Map name -> transition record.
export function transitionsByName(registryPath = DEFAULT_REGISTRY_PATH) {
  const data = loadTransitionRegistry(registryPath);
  const map = new Map();
  for (const t of data.transitions) map.set(t.name, t);
  return map;
}

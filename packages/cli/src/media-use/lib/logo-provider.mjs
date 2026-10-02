import { fetchMedia, readCappedBody } from "./media-fetch.mjs";
// Official brand marks — the `logo` type's provider tiers, tried in registry
// order.
//
//   1. thesvg: one pinned manifest matched locally ("Next.js", "nextjs", "next js" hit one
//      entry); default full-color mark; skips licenses outside THESVG_ACCEPTED_LICENSES.
//   2. github avatar: known orgs only; guessing a login risks a same-named personal account.
//   3. domain favicon: DuckDuckGo ip3 last resort; under ~500B is its globe placeholder.
//
// HeyGen asset search is deliberately absent: for brand queries it returns
// generic look-alike icons (0/3 in testing) — worse than a miss. A total miss
// falls through to resolve's normal failure path (`no provider could resolve
// logo`, exit 1).

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bump by pointing at a newer glincker/thesvg commit; the manifest and every
// icon URL resolve against the same pin, so a resolve is reproducible.
const THESVG_REV = "e5957fa742c1ebf6da07ac40665bdd01d8add35f";
const THESVG_CDN = `https://cdn.jsdelivr.net/gh/glincker/thesvg@${THESVG_REV}`;
const THESVG_MANIFEST = `${THESVG_CDN}/src/data/icons.json`;
const FAVICON_MIN_BYTES = 500;
// ponytail: the manifest is ~3.3MB today; 20MB leaves headroom without trusting an
// unbounded body from a CDN edge.
const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;

// When several entries share a normalized name (e.g. "slack" and the
// "slack-badge" auth button), the brand mark wins over cloud/infra and badge
// collections.
const THESVG_COLLECTION_RANK = ["brands", "community", "aws", "azure", "gcp", "k8s", "auth-badges"];

// The ten SPDX ids theSVG's submission form accepts and verifies before merge
// (thesvg.org LICENSING.md §5); anything else routes through their unaudited
// "Other/custom" path.
const THESVG_ACCEPTED_LICENSES = new Set([
  "CC0-1.0",
  "Unlicense",
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "ISC",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-ND-4.0",
  "MPL-2.0",
]);

// Known GitHub orgs. Only mapped entities resolve at this tier — a brand name
// is NOT a GitHub login, and guessing hits same-named personal accounts.
const GITHUB_ORGS = {
  slack: "slackhq",
  meta: "facebook",
  google: "google",
  microsoft: "microsoft",
  aws: "aws",
  vercel: "vercel",
  nextjs: "vercel",
  alibaba: "alibaba",
  heygen: "heygen-com",
};

// Favicon domains that aren't `<entity>.com`.
const FAVICON_DOMAINS = {
  cocacola: "coca-cola.com",
  aws: "aws.amazon.com",
  nextjs: "nextjs.org",
};

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** The brand entity for a query: --entity wins; else the intent minus filler. */
export function entityFrom(intent, entity) {
  if (entity) return entity.toLowerCase().trim();
  return String(intent)
    .toLowerCase()
    .replace(/\b(logo|logos|icon|brand|official|mark)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Exact match after stripping case/spacing/punctuation — "Next.js" ≡ "nextjs". */
export function titleMatches(title, entity) {
  return norm(title) === norm(entity);
}

/** Best theSVG entry for an entity, or null: slug > title > alias, ties to the brands
 * collection; entries outside THESVG_ACCEPTED_LICENSES are never returned. */
export function thesvgMatch(icons, entity) {
  const want = norm(entity);
  if (!want || !Array.isArray(icons)) return null;
  const collectionRank = (icon) => {
    const i = THESVG_COLLECTION_RANK.indexOf(icon.collection);
    return i === -1 ? THESVG_COLLECTION_RANK.length : i;
  };
  let best = null;
  let bestScore = Infinity;
  for (const icon of icons) {
    if (!icon || typeof icon.slug !== "string" || !icon.variants?.default) continue;
    if (!THESVG_ACCEPTED_LICENSES.has(icon.license)) continue;
    let field;
    if (norm(icon.slug) === want) field = 0;
    else if (titleMatches(icon.title, want)) field = 1;
    else if ((icon.aliases || []).some((a) => titleMatches(a, want))) field = 2;
    else continue;
    const score = field * 100 + collectionRank(icon);
    if (score < bestScore) {
      best = icon;
      bestScore = score;
    }
  }
  return best;
}

export function githubOrgFor(entity) {
  return GITHUB_ORGS[norm(entity)] || null;
}

export function faviconDomainFor(entity) {
  return FAVICON_DOMAINS[norm(entity)] || `${norm(entity)}.com`;
}

async function fetchJson(url) {
  const res = await fetchMedia(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const body = await readCappedBody(res, MAX_MANIFEST_BYTES, "fetchJson");
  return JSON.parse(body.toString("utf8"));
}

async function urlExists(url) {
  const res = await fetchMedia(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
  return res.ok;
}

// One manifest per process: a multi-logo resolve pays the download once. A
// failed load is not cached, so the next call retries.
let thesvgManifest = null;

async function loadThesvgManifest() {
  if (!thesvgManifest) {
    thesvgManifest = fetchJson(THESVG_MANIFEST).then((icons) => {
      if (!Array.isArray(icons)) throw new Error("theSVG manifest: unexpected shape");
      return icons;
    });
    thesvgManifest.catch(() => {
      thesvgManifest = null;
    });
  }
  return thesvgManifest;
}

/** Test hook: drop the memoized manifest. */
export function resetThesvgManifest() {
  thesvgManifest = null;
}

export async function thesvgSearch(intent, ctx = {}) {
  const entity = entityFrom(intent, ctx.entity);
  let icons;
  try {
    icons = await loadThesvgManifest();
  } catch {
    return null; // network down or bad payload — let the next tier try its own host
  }
  const hit = thesvgMatch(icons, entity);
  if (!hit) return null;
  // theSVG also ships mono, light/dark and wordmark variants; default is the full-color mark.
  const route = hit.variants.default;
  return {
    url: `${THESVG_CDN}/public${route.startsWith("/") ? "" : "/"}${route}`,
    ext: ".svg",
    source: "search",
    metadata: {
      description: `${hit.title} logo (official mark)`,
      provider: "thesvg",
      provenance: {
        entity,
        slug: hit.slug,
        variant: "default",
        variants: Object.keys(hit.variants),
        collection: hit.collection,
        license: hit.license,
        pinned: `glincker/thesvg@${THESVG_REV}`,
      },
    },
  };
}

export async function githubAvatarSearch(intent, ctx = {}) {
  const entity = entityFrom(intent, ctx.entity);
  const org = githubOrgFor(entity);
  if (!org) return null;
  const url = `https://github.com/${org}.png?size=460`;
  try {
    if (!(await urlExists(url))) return null;
  } catch {
    return null;
  }
  return {
    url,
    ext: ".png",
    source: "search",
    metadata: {
      description: `${entity} logo (GitHub org avatar)`,
      provider: "github.avatar",
      provenance: { entity, org },
    },
  };
}

export async function faviconSearch(intent, ctx = {}) {
  const entity = entityFrom(intent, ctx.entity);
  const domain = faviconDomainFor(entity);
  const url = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  let body;
  try {
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    body = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (body.byteLength < FAVICON_MIN_BYTES) return null; // DDG placeholder, not a logo
  // Hand the verified bytes over as a local file: the freeze step copies it
  // instead of re-downloading, so the size check is authoritative over what
  // gets frozen and the favicon tier costs one network round-trip, not two.
  const bytes = body.byteLength;
  const tmp = join(mkdtempSync(join(tmpdir(), "media-use-logo-")), `${domain}.ico`);
  writeFileSync(tmp, body);
  return {
    localPath: tmp,
    ext: ".ico",
    source: "search",
    metadata: {
      description: `${entity} favicon (small raster — chip-size use only)`,
      provider: "favicon.ddg",
      provenance: { entity, domain, bytes, low_res: true },
    },
  };
}

// Official brand marks — the `logo` type's provider tiers, tried in registry
// order. Every tier was verified against a 54-brand stress test (2026-07,
// 100% cascade hit). Hit counts below are a snapshot of that run — they
// drift as the alias/org maps grow; re-run the stress test to refresh them.
//
//   1. svgl          — official full-color vector SVGs (+ wordmark variants);
//                      40/54 first-hits. Search is substring-based, so
//                      entities go through alias normalization first
//                      ("nextjs" never matches "Next.js" raw).
//   2. simple-icons  — monochrome official glyphs; caught the long tail the
//                      others miss (nike, visa, toyota, wechat, bytedance).
//                      Pinned CDN build for determinism.
//   3. github avatar — the org's official logo for brands with a GitHub
//                      presence. Known orgs only: guessing a login risks a
//                      same-named personal account.
//   4. domain favicon — small-raster last resort (DuckDuckGo ip3). Responses
//                      under ~500B are DDG's globe placeholder, not a hit.
//
// HeyGen asset search is deliberately absent: for brand queries it returns
// generic look-alike icons (0/3 in testing) — worse than a miss. A total miss
// falls through to resolve's normal failure path (`no provider could resolve
// logo`, exit 1).

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SVGL_API = "https://api.svgl.app";
const SIMPLE_ICONS_CDN = "https://cdn.jsdelivr.net/npm/simple-icons@16.25.0/icons";
const FAVICON_MIN_BYTES = 500;

// svgl search queries per entity, tried in order after the raw entity.
const SVGL_ALIASES = {
  nextjs: ["next.js", "next"],
  aws: ["amazon web services"],
  huggingface: ["hugging face"],
  cocacola: ["coca-cola"],
  mcdonalds: ["mcdonald's"],
};

// simple-icons slugs that differ from the normalized entity.
const SIMPLE_ICON_SLUGS = {
  nextjs: "nextdotjs",
  aws: "amazonwebservices",
};

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

export function svglQueriesFor(entity) {
  return [entity, ...(SVGL_ALIASES[norm(entity)] || [])];
}

export function simpleIconSlugsFor(entity) {
  const slugs = [norm(entity)];
  const alias = SIMPLE_ICON_SLUGS[norm(entity)];
  if (alias) slugs.push(alias);
  return slugs;
}

export function githubOrgFor(entity) {
  return GITHUB_ORGS[norm(entity)] || null;
}

export function faviconDomainFor(entity) {
  return FAVICON_DOMAINS[norm(entity)] || `${norm(entity)}.com`;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  return res.json();
}

async function urlExists(url) {
  const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
  return res.ok;
}

export async function svglSearch(intent, ctx = {}) {
  const entity = entityFrom(intent, ctx.entity);
  for (const q of svglQueriesFor(entity)) {
    let items;
    try {
      items = await fetchJson(`${SVGL_API}?search=${encodeURIComponent(q)}`);
    } catch {
      return null; // network down — let the next tier try its own host
    }
    if (!Array.isArray(items)) continue;
    const hit = items.find((it) => titleMatches(it.title, q) || titleMatches(it.title, entity));
    if (!hit) continue;
    const route = typeof hit.route === "string" ? hit.route : hit.route?.light;
    if (!route) continue;
    return {
      url: route,
      ext: ".svg",
      source: "search",
      metadata: {
        description: `${hit.title} logo (official mark)`,
        provider: "svgl",
        provenance: { entity, query: q, route, wordmark: Boolean(hit.wordmark) },
      },
    };
  }
  return null;
}

export async function simpleIconsSearch(intent, ctx = {}) {
  const entity = entityFrom(intent, ctx.entity);
  for (const slug of simpleIconSlugsFor(entity)) {
    const url = `${SIMPLE_ICONS_CDN}/${slug}.svg`;
    let ok;
    try {
      ok = await urlExists(url);
    } catch {
      return null;
    }
    if (!ok) continue;
    return {
      url,
      ext: ".svg",
      source: "search",
      metadata: {
        description: `${entity} logo (official monochrome glyph)`,
        provider: "simple-icons",
        provenance: { entity, slug, pinned: "simple-icons@16.25.0" },
      },
    };
  }
  return null;
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
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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

import { statSync } from "node:fs";
import { readGlobalManifest } from "./cache.mjs";
import { readManifest } from "./manifest.mjs";
import { readMisses } from "./misses.mjs";

const TOP_MISSES = 5;

function emptyReport() {
  return {
    total_resolves: 0,
    by_type: {},
    by_source: {},
    by_provider: {},
    by_via: {},
    misses: 0,
    hit_rate: null,
    top_missed_intents: {},
    global_cache_assets: 0,
    global_cache_disk_bytes: 0,
    cross_project_reuse: 0,
  };
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function timestampOf(record) {
  return record?.ts || record?.timestamp || record?.created_at || record?.createdAt || null;
}

function inWindow(record, cutoff) {
  if (!cutoff) return true;
  const ts = timestampOf(record);
  // Older manifest records may not carry a timestamp; keep them in the report
  // because --days can only window records/misses that carry a ts/timestamp.
  if (!ts) return true;
  const time = Date.parse(ts);
  return Number.isNaN(time) ? true : time >= cutoff;
}

function sourceOf(record) {
  return record?._source || record?.source || record?.provenance?.source || "unknown";
}

function normalizeIntent(intent) {
  return String(intent ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function topMissedIntents(misses) {
  const grouped = {};
  for (const miss of misses) {
    const type = miss?.type || "unknown";
    const intent = normalizeIntent(miss?.intent);
    if (!intent) continue;
    grouped[type] ||= {};
    grouped[type][intent] = (grouped[type][intent] || 0) + 1;
  }
  const out = {};
  for (const [type, intents] of Object.entries(grouped)) {
    out[type] = Object.entries(intents)
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count || a.intent.localeCompare(b.intent))
      .slice(0, TOP_MISSES);
  }
  return out;
}

function diskBytes(records) {
  let total = 0;
  for (const record of records) {
    const p = record?.cached_path || record?.path;
    if (!p) continue;
    try {
      total += statSync(p).size;
    } catch {
      // cache entries can outlive files; stats skips missing files
    }
  }
  return total;
}

export function buildStats({ projectDir, days, now = Date.now() } = {}) {
  // Only a positive finite --days windows the report; null / NaN / <= 0 mean
  // "all time" rather than silently excluding everything (a negative cutoff
  // would land in the future and drop every record). The reads below are each
  // best-effort (they return [] / skip on IO errors), so there is no top-level
  // catch masking a real logic bug as an all-zero "no usage" report.
  const n = Number(days);
  const cutoff = Number.isFinite(n) && n > 0 ? Number(now) - n * 24 * 60 * 60 * 1000 : null;
  const records = (projectDir ? readManifest(projectDir) : []).filter((r) => inWindow(r, cutoff));
  const misses = readMisses().filter((miss) => inWindow(miss, cutoff));
  const globalRecords = readGlobalManifest();
  const report = emptyReport();

  report.total_resolves = records.length;
  report.misses = misses.length;
  for (const record of records) {
    increment(report.by_type, record?.type || "unknown");
    increment(report.by_source, sourceOf(record));
    increment(report.by_provider, record?.provenance?.provider);
    increment(report.by_via, record?.provenance?.via);
  }

  const attempts = report.total_resolves + report.misses;
  report.hit_rate = attempts === 0 ? null : report.total_resolves / attempts;
  report.top_missed_intents = topMissedIntents(misses);
  report.global_cache_assets = globalRecords.length;
  report.global_cache_disk_bytes = diskBytes(globalRecords);
  report.cross_project_reuse = globalRecords.filter((r) => r?.provenance?.reused_by).length;

  return report;
}

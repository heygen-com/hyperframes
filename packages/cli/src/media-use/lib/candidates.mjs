// Reuse candidates: a side-effect-free view of assets already available to this
// project (its own manifest) and across every project (the global ~/.media
// cache), so the calling agent can judge semantic fit itself. No download, no
// provider, no mutation. The ranker only *surfaces* — it orders by lexical
// overlap but never filters a candidate out on zero overlap (that would
// pre-empt the agent's judgment); the agent does the semantic call.

import { readManifest } from "./manifest.mjs";
import { readGlobalManifest } from "./cache.mjs";
import { tokenOverlap, typesMatch } from "./match.mjs";

export const CANDIDATE_CAP = 8;

function shape(record, scope, intent) {
  const description = record.description || record.provenance?.prompt || "";
  const prompt = record.provenance?.prompt || null;
  return {
    id: record.id,
    type: record.type,
    scope,
    description,
    prompt,
    provider: record.provenance?.provider || null,
    duration: record.duration ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    // Only global records carry a content sha — it is the stable reuse handle
    // for `resolve --reuse <sha>`. Project assets are reused by referencing
    // their path directly, so they need no handle.
    sha: scope === "global" ? record.sha || null : null,
    path: scope === "project" ? record.path : null,
    score: intent ? tokenOverlap(intent, `${description} ${prompt || ""}`) : 0,
  };
}

// Rank one scope: type-matched (icon<->image aware), newest-first within equal
// overlap, ordered by overlap desc. Returns the full ranked list (uncapped).
function rankScope(records, scope, type, intent) {
  return records
    .filter((r) => typesMatch(r.type, type))
    .reverse() // manifest is append-order (oldest first); newest-first at equal score
    .map((r) => shape(r, scope, intent))
    .sort((a, b) => b.score - a.score); // Array.sort is stable → recency preserved
}

// List reuse candidates for `type`, capped per scope. Returns:
//   candidates: capped project candidates followed by capped global candidates
//   truncated:  true if either scope had more than `cap`
//   total:      { project, global } counts before the cap (machine-readable)
//   similar:    count of candidates with lexical overlap > 0 (drives the nudge)
export function listCandidates({ projectDir, type, intent = "", cap = CANDIDATE_CAP }) {
  const project = rankScope(readManifest(projectDir), "project", type, intent);
  const global = rankScope(readGlobalManifest(), "global", type, intent);
  const candidates = [...project.slice(0, cap), ...global.slice(0, cap)];
  return {
    candidates,
    truncated: project.length > cap || global.length > cap,
    total: { project: project.length, global: global.length },
    similar: [...project, ...global].filter((c) => c.score > 0).length,
  };
}

function meta(c) {
  const parts = [];
  if (c.duration != null) parts.push(`${c.duration}s`);
  if (c.width && c.height) parts.push(`${c.width}x${c.height}`);
  if (c.provider) parts.push(c.provider);
  return parts.join(", ");
}

// Human-readable listing. The agent can read this directly; --json is for
// programmatic use. Reuse handle differs by scope: path for project, sha for
// global.
export function formatCandidates(candidates, { truncated, total } = {}) {
  if (candidates.length === 0) return "no reuse candidates found (project or global cache)";
  const lines = [`${candidates.length} reuse candidate${candidates.length === 1 ? "" : "s"}:`, ""];
  for (const c of candidates) {
    const handle =
      c.scope === "global" ? `--reuse ${String(c.sha).slice(0, 16)}` : c.path || `manifest:${c.id}`;
    const m = meta(c);
    lines.push(`  [${c.scope}] ${c.description}${m ? ` (${m})` : ""}`);
    lines.push(`          ${handle}`);
  }
  if (truncated && total) {
    lines.push("");
    lines.push(
      `  (showing top ${CANDIDATE_CAP} per scope; ${total.project} project / ${total.global} global total — refine --intent to narrow)`,
    );
  }
  return lines.join("\n");
}

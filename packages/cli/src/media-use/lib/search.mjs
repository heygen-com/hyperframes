// Paginated text search over a manifest (project or global) by id / description
// / entity. Plain substring match — no vector DB (B4): the agent's own file
// search covers semantics; this just keeps result pages small enough to not
// blow the context window.

const PAGE = 10;

export function searchRecords(records, query, { page = 1, pageSize = PAGE } = {}) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const matched = q
    ? records.filter((r) =>
        [r.id, r.description, r.entity, r.type].some(
          (f) => f && String(f).toLowerCase().includes(q),
        ),
      )
    : records.slice();
  const total = matched.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  return { results: matched.slice(start, start + pageSize), total, page: p, pages, pageSize };
}

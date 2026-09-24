import { useEffect, useMemo, useState } from "react";

// Cross-project asset view — the global media-use cache (~/.media), fetched from
// /api/assets/global. Self-contained (owns its fetch + state) so AssetsTab stays
// focused on the local view.

export interface GlobalAssetRecord {
  id?: string;
  type?: string;
  description?: string;
  entity?: string;
  sha?: string;
}

export interface GlobalAssetRow {
  id: string;
  type: string;
  label: string;
}

/**
 * Normalize global records into display rows, filtered by an optional query
 * (id / type / description / entity). Pure — unit-tested.
 */
export function globalAssetRows(records: GlobalAssetRecord[], query = ""): GlobalAssetRow[] {
  const q = query.trim().toLowerCase();
  return records
    .filter((r) =>
      !q
        ? true
        : [r.id, r.type, r.description, r.entity].some(
            (f) => f && String(f).toLowerCase().includes(q),
          ),
    )
    .map((r) => ({
      id: r.id ?? r.sha ?? "asset",
      type: r.type ?? "asset",
      label: r.description || r.entity || r.id || r.sha || "asset",
    }));
}

export function GlobalAssetsView({ searchQuery }: { searchQuery: string }) {
  const [records, setRecords] = useState<GlobalAssetRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/assets/global")
      .then((r) => {
        if (!r.ok) throw new Error(`Global asset request failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) {
          setError(false);
          setRecords(Array.isArray(d.assets) ? d.assets : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setRecords(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  const rows = useMemo(() => globalAssetRows(records ?? [], searchQuery), [records, searchQuery]);

  if (records === null) {
    if (error) {
      return (
        <div className="px-4 py-3 text-[11px] text-panel-text-5">
          <p>Unable to load global assets.</p>
          <button
            type="button"
            className="mt-2 text-panel-text-1 underline underline-offset-2"
            onClick={() => {
              setError(false);
              setRetryCount((count) => count + 1);
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return <p className="px-4 py-3 text-[11px] text-panel-text-5">Loading global assets…</p>;
  }
  if (rows.length === 0) {
    if (searchQuery.trim()) {
      return (
        <p className="px-4 py-3 text-[11px] text-panel-text-5">
          No global assets match “{searchQuery}”.
        </p>
      );
    }
    return (
      <p className="px-4 py-3 text-[11px] text-panel-text-5">
        No assets in the global cache yet. Resolved media is promoted to <code>~/.media</code> and
        becomes reusable across projects.
      </p>
    );
  }
  return (
    <div>
      <div className="px-4 py-2 border-t border-panel-border text-[11px] text-panel-text-5">
        {rows.length} reusable across all projects
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="px-4 py-1.5 flex items-center gap-2.5 border-l-2 border-transparent hover:bg-neutral-800/50"
          title={`${row.id} · ${row.type}`}
        >
          <span className="text-[9px] font-medium text-neutral-600 uppercase w-10 shrink-0">
            {row.type}
          </span>
          <span className="text-xs text-panel-text-1 truncate">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

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

type GlobalAssetsLoad =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; records: GlobalAssetRecord[] };

export function GlobalAssetsView({ searchQuery }: { searchQuery: string }) {
  const [load, setLoad] = useState<GlobalAssetsLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/assets/global")
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/assets/global responded ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) {
          setLoad({ status: "loaded", records: Array.isArray(d.assets) ? d.assets : [] });
        }
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const rows = useMemo(
    () => (load.status === "loaded" ? globalAssetRows(load.records, searchQuery) : []),
    [load, searchQuery],
  );

  if (load.status === "loading") {
    return <p className="px-4 py-3 text-[11px] text-panel-text-5">Loading global assets…</p>;
  }
  if (load.status === "failed") {
    return (
      <div className="px-4 py-3 flex flex-col items-start gap-2">
        <p className="text-[11px] text-panel-text-5">Couldn't load the global asset cache.</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-panel-input text-panel-text-3 hover:text-panel-text-1 active:scale-[0.98] transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
  if (rows.length === 0 && load.records.length > 0) {
    return (
      <p className="px-4 py-3 text-[11px] text-panel-text-5">
        No global assets match &ldquo;{searchQuery}&rdquo;
      </p>
    );
  }
  if (rows.length === 0) {
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

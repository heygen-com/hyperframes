// fallow-ignore-file code-duplication
import { memo, useState, useCallback, useRef, useMemo, useEffect } from "react";
import { MEDIA_EXT, FONT_EXT } from "../../utils/mediaTypes";
import { copyTextToClipboard } from "../../utils/clipboard";
import { usePlayerStore } from "../../player/store/playerStore";
import { type MediaCategory, getCategory, CATEGORY_LABELS, FILTER_ORDER } from "./assetHelpers";
import { AudioRow } from "./AudioRow";
import { GlobalAssetsView } from "./GlobalAssetsView";
import { AssetCard, FontRow } from "./AssetCard";

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  onImport?: (files: FileList) => void;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}

export type UsageFilter = "all" | "used" | "unused";

/** Filter assets by whether the composition references them. Pure — unit-tested. */
export function filterByUsage(
  assets: string[],
  usedPaths: Set<string>,
  usageFilter: UsageFilter,
): string[] {
  if (usageFilter === "used") return assets.filter((a) => usedPaths.has(a));
  if (usageFilter === "unused") return assets.filter((a) => !usedPaths.has(a));
  return assets;
}

/** Count used vs unused over a media set. Pure — unit-tested. */
export function countUsage(
  assets: string[],
  usedPaths: Set<string>,
): { used: number; unused: number } {
  let used = 0;
  for (const a of assets) if (usedPaths.has(a)) used++;
  return { used, unused: assets.length - used };
}

/**
 * Project-relative asset paths referenced by composition elements — the set the
 * "in use" badge, used-first sort, and usage filter all key on. Element src is
 * populated from the core runtime's `resolveNodeAssetUrl` which calls
 * `new URL(raw, document.baseURI).toString()`, turning authored relative paths
 * into fully-absolute URLs with percent-encoded characters, e.g.
 *   "assets/my file (1).mp4"
 *   → "http://localhost:3012/api/projects/demo/preview/assets/my%20file%20(1).mp4"
 *
 * This function normalizes every src shape to the bare project-relative path so
 * it matches the asset-list entries:
 *   - Absolute URL  → strip origin + /api/projects/<id>/preview/ prefix, decode %XX
 *   - Server-relative /api/…preview/… → same strip + decode
 *   - Relative "./"-prefixed or bare → strip leading ./ or /
 *   - ?query / #hash → dropped
 *
 * Pure — unit-tested.
 */
export function deriveUsedPaths(elements: Array<{ src?: string }>): Set<string> {
  const paths = new Set<string>();
  for (const el of elements) {
    if (!el.src) continue;
    let s = el.src;

    // Strip absolute origin if present (http://host/path → /path)
    try {
      const u = new URL(s);
      s = u.pathname + (u.search ? u.search : "") + (u.hash ? u.hash : "");
    } catch {
      // Not a valid absolute URL — leave as-is (relative path)
    }

    s = s
      .replace(/^\/api\/projects\/[^/]+\/preview\//, "") // strip the dev serve prefix
      .replace(/^\.?\//, "") // strip leading ./ or /
      .split(/[?#]/)[0]; // drop query / hash

    // Decode percent-encoded characters (spaces, parens, etc.) so the path
    // matches the plain-text asset-list entries the server returns.
    try {
      s = decodeURIComponent(s);
    } catch {
      // Malformed encoding — use as-is
    }

    if (s) paths.add(s);
  }
  return paths;
}

export const AssetsTab = memo(function AssetsTab({
  projectId,
  assets,
  onImport,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: AssetsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<MediaCategory | "all">("all");
  const [usageFilter, setUsageFilter] = useState<"all" | "used" | "unused">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"local" | "global">("local");
  const [manifest, setManifest] = useState<
    Map<string, { description?: string; duration?: number; width?: number; height?: number }>
  >(new Map());

  const manifest404Ref = useRef<Set<string>>(new Set());
  const assetsKey = assets.join("|");
  useEffect(() => {
    if (manifest404Ref.current.has(projectId)) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/preview/.media/manifest.jsonl`)
      .then((r) => {
        if (!r.ok) {
          manifest404Ref.current.add(projectId);
          return "";
        }
        return r.text();
      })
      .then((text) => {
        if (cancelled || !text) return;
        const m = new Map<
          string,
          { description?: string; duration?: number; width?: number; height?: number }
        >();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line);
            if (rec.path) m.set(rec.path, rec);
          } catch {
            /* skip */
          }
        }
        setManifest(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, assetsKey]);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) onImport?.(e.dataTransfer.files);
    },
    [onImport],
  );
  const handleCopyPath = useCallback(async (path: string) => {
    const copied = await copyTextToClipboard(path);
    if (copied) {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    }
  }, []);
  const elements = usePlayerStore((s) => s.elements);
  const usedPaths = useMemo(() => deriveUsedPaths(elements), [elements]);
  const mediaAssets = useMemo(() => {
    const media = assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a));
    const all = filterByUsage(media, usedPaths, usageFilter);
    if (!searchQuery) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((a) => {
      if (
        a
          .split("/")
          .pop()
          ?.replace(/\.[^.]*$/, "")
          .toLowerCase()
          .includes(q)
      )
        return true;
      const rec = manifest.get(a);
      return rec?.description?.toLowerCase().includes(q);
    });
  }, [assets, searchQuery, manifest, usageFilter, usedPaths]);
  const categorized = useMemo(() => {
    const groups: Record<MediaCategory, string[]> = { audio: [], images: [], video: [], fonts: [] };
    for (const a of mediaAssets) {
      const cat = getCategory(a);
      if (cat) groups[cat].push(a);
    }
    // Sort: used assets first within each category
    for (const cat of FILTER_ORDER) {
      groups[cat].sort((a, b) => {
        const aUsed = usedPaths.has(a) ? 0 : 1;
        const bUsed = usedPaths.has(b) ? 0 : 1;
        return aUsed - bUsed;
      });
    }
    return groups;
  }, [mediaAssets, usedPaths]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: mediaAssets.length };
    for (const cat of FILTER_ORDER) c[cat] = categorized[cat].length;
    return c;
  }, [mediaAssets, categorized]);
  const usageCounts = useMemo(
    () =>
      countUsage(
        assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a)),
        usedPaths,
      ),
    [assets, usedPaths],
  );
  const visibleCategories =
    activeFilter === "all"
      ? FILTER_ORDER.filter((c) => categorized[c].length > 0)
      : [activeFilter as MediaCategory].filter((c) => categorized[c].length > 0);
  return (
    <div
      className={`flex-1 flex flex-col min-h-0 transition-colors ${dragOver ? "bg-studio-accent/[0.05]" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header — matches design panel Section pattern */}
      <div className="px-4 pt-2.5 pb-1.5 flex-shrink-0">
        {/* Scope toggle */}
        <div className="flex gap-1 mb-2.5 p-0.5 rounded-md bg-panel-input">
          {(["local", "global"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`flex-1 px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                viewMode === m
                  ? "bg-panel-accent/15 text-panel-accent"
                  : "text-panel-text-3 hover:text-panel-text-1"
              }`}
            >
              {m === "local" ? "This project" : "All projects"}
            </button>
          ))}
        </div>
        {/* Import */}
        {onImport && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-panel-input px-3 py-[7px] text-[11px] font-medium text-panel-text-3 hover:text-panel-text-1 transition-colors mb-2.5"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Import media
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*,audio/*,font/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  onImport(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </>
        )}

        {/* Search */}
        {mediaAssets.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-md bg-panel-input px-2.5 py-[5px] mb-2">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="none" className="flex-shrink-0">
              <circle
                cx="116"
                cy="116"
                r="76"
                stroke="currentColor"
                strokeWidth="22"
                className="text-panel-text-5"
              />
              <line
                x1="170"
                y1="170"
                x2="232"
                y2="232"
                stroke="currentColor"
                strokeWidth="22"
                strokeLinecap="round"
                className="text-panel-text-5"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="min-w-0 w-full bg-transparent text-[11px] text-panel-text-1 outline-none placeholder:text-panel-text-5"
            />
          </div>
        )}

        {/* Filter chips */}
        {viewMode === "local" && mediaAssets.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                activeFilter === "all"
                  ? "bg-panel-accent/15 text-panel-accent"
                  : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
              }`}
            >
              All {counts.all}
            </button>
            {FILTER_ORDER.map((cat) =>
              counts[cat] > 0 ? (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(activeFilter === cat ? "all" : cat)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    activeFilter === cat
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  {CATEGORY_LABELS[cat]} {counts[cat]}
                </button>
              ) : null,
            )}
            {usageCounts.used > 0 && usageCounts.unused > 0 && (
              <>
                <span className="w-px self-stretch bg-panel-input mx-0.5" aria-hidden="true" />
                <button
                  onClick={() => setUsageFilter(usageFilter === "used" ? "all" : "used")}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    usageFilter === "used"
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  In use {usageCounts.used}
                </button>
                <button
                  onClick={() => setUsageFilter(usageFilter === "unused" ? "all" : "unused")}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    usageFilter === "unused"
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  Unused {usageCounts.unused}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mt-1">
        {viewMode === "global" ? (
          <GlobalAssetsView searchQuery={searchQuery} />
        ) : mediaAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-neutral-700"
            >
              <path
                d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
            </svg>
            <p className="text-[10px] text-neutral-600 text-center">Drop media files here</p>
          </div>
        ) : (
          visibleCategories.map((cat) => (
            <div key={cat} className="mb-1">
              {activeFilter === "all" && (
                <div className="flex items-center gap-2 px-4 py-2 border-t border-panel-border">
                  <h3 className="text-[12px] font-semibold text-panel-text-1">
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <span className="text-[11px] text-panel-text-5">{categorized[cat].length}</span>
                </div>
              )}
              {cat === "audio" &&
                categorized[cat].map((a) => (
                  <AudioRow
                    key={a}
                    projectId={projectId}
                    asset={a}
                    used={usedPaths.has(a)}
                    meta={manifest.get(a)}
                    onCopy={handleCopyPath}
                    isCopied={copiedPath === a}
                    onDelete={onDelete}
                    onRename={onRename}
                    onAddAssetToTimeline={onAddAssetToTimeline}
                  />
                ))}
              {(cat === "images" || cat === "video") && (
                <div className="grid grid-cols-2 gap-1 px-2 pb-1">
                  {categorized[cat].map((a) => (
                    <AssetCard
                      key={a}
                      projectId={projectId}
                      asset={a}
                      used={usedPaths.has(a)}
                      duration={manifest.get(a)?.duration}
                      onCopy={handleCopyPath}
                      isCopied={copiedPath === a}
                      onDelete={onDelete}
                      onRename={onRename}
                      onAddAssetToTimeline={onAddAssetToTimeline}
                    />
                  ))}
                </div>
              )}
              {cat === "fonts" &&
                categorized[cat].map((a) => (
                  <FontRow
                    key={a}
                    asset={a}
                    used={usedPaths.has(a)}
                    onCopy={handleCopyPath}
                    isCopied={copiedPath === a}
                    onDelete={onDelete}
                    onRename={onRename}
                    onAddAssetToTimeline={onAddAssetToTimeline}
                  />
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
});

import { memo, useState, useCallback, useRef, useMemo, useEffect } from "react";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import { SearchInput } from "../ui/SearchInput";
import { MEDIA_EXT, IMAGE_EXT, VIDEO_EXT, FONT_EXT } from "../../utils/mediaTypes";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import { copyTextToClipboard } from "../../utils/clipboard";
import { ContextMenu } from "./AssetContextMenu";
import { usePlayerStore } from "../../player/store/playerStore";
import {
  type MediaCategory,
  type CopyFeedback,
  getCategory,
  basename,
  ext,
  CATEGORY_LABELS,
  FILTER_ORDER,
} from "./assetHelpers";
import { AudioRow } from "./AudioRow";

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  onImport?: (files: FileList) => void | Promise<void>;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
}

// fallow-ignore-next-line complexity
function ImageCard({
  projectId,
  asset,
  used,
  onCopy,
  copyFeedback,
  onDelete,
  onRename,
  size,
}: {
  projectId: string;
  asset: string;
  used: boolean;
  onCopy: (path: string) => void;
  copyFeedback: CopyFeedback;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  size: "large" | "small";
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const name = basename(asset);
  const extension = ext(asset);
  const serveUrl = `/api/projects/${projectId}/preview/${asset}`;
  const isVideo = VIDEO_EXT.test(asset);
  const isImage = IMAGE_EXT.test(asset);
  const isCopied = copyFeedback?.path === asset && copyFeedback.ok;
  const copyFailed = copyFeedback?.path === asset && !copyFeedback.ok;

  const thumbW = size === "large" ? "w-full" : "w-[50px]";
  const thumbH = size === "large" ? "h-[100px]" : "h-[32px]";

  // Visible cue for the click affordance (A1) and its outcome (F3).
  const copyChip = (
    <span
      className={`flex-shrink-0 text-[9px] font-medium px-1.5 py-px rounded transition-opacity ${
        copyFailed
          ? "text-red-400 bg-red-500/10 opacity-100"
          : isCopied
            ? "text-panel-accent bg-panel-accent/10 opacity-100"
            : "text-panel-text-5 bg-panel-input opacity-0 group-hover/asset:opacity-100 group-focus-within/asset:opacity-100"
      }`}
    >
      {copyFailed ? "Copy failed" : isCopied ? "Copied" : "Copy path"}
    </span>
  );

  return (
    <>
      <div
        draggable
        role="button"
        tabIndex={0}
        aria-label={`${name} — copy path, drag to timeline, right-click for actions`}
        onClick={() => onCopy(asset)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCopy(asset);
          }
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset }));
          e.dataTransfer.setData("text/plain", asset);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className={`group/asset transition-colors cursor-pointer outline-none focus-visible:bg-neutral-800/60 ${
          size === "large"
            ? `px-2.5 py-1 ${isCopied ? "bg-studio-accent/10" : "hover:bg-neutral-800/30"}`
            : `px-2.5 py-1.5 flex items-center gap-2.5 ${
                isCopied
                  ? "bg-studio-accent/10 border-l-2 border-studio-accent"
                  : "border-l-2 border-transparent hover:bg-neutral-800/50"
              }`
        }`}
      >
        {size === "large" ? (
          <div className="flex flex-col gap-1">
            <div className={`${thumbW} ${thumbH} rounded overflow-hidden bg-neutral-900 relative`}>
              {isImage && !imgError && (
                <img
                  src={serveUrl}
                  alt={name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              )}
              {isImage && imgError && (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-[9px] font-medium text-neutral-700">{extension}</span>
                </div>
              )}
              {isVideo && <VideoFrameThumbnail src={serveUrl} fallbackLabel={extension} />}
              {isVideo && hovered && (
                <video
                  src={serveUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs font-medium truncate ${used ? "text-panel-text-1" : "text-panel-text-3"}`}
              >
                {name}
              </span>
              <span className="text-[10px] text-neutral-600">{extension}</span>
              {used && (
                <span className="text-[9px] font-medium text-panel-accent bg-panel-accent/10 px-1.5 py-px rounded">
                  in use
                </span>
              )}
              {copyChip}
            </div>
          </div>
        ) : (
          <>
            <div className="w-[50px] h-[32px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 flex items-center justify-center">
              {isImage && !imgError && (
                <img
                  src={serveUrl}
                  alt={name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              )}
              {(!isImage || imgError) && (
                <span className="text-[9px] font-medium text-neutral-700">{extension}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span
                className={`text-xs font-medium truncate block ${used ? "text-panel-text-1" : "text-panel-text-3"}`}
              >
                {name}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-600 truncate">{extension}</span>
                {used && (
                  <span className="text-[9px] font-medium text-panel-accent bg-panel-accent/10 px-1.5 py-px rounded">
                    in use
                  </span>
                )}
                {copyChip}
              </div>
            </div>
          </>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          onRename={onRename}
        />
      )}
    </>
  );
}

export const AssetsTab = memo(function AssetsTab({
  projectId,
  assets,
  onImport,
  onDelete,
  onRename,
}: AssetsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [importing, setImporting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<MediaCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [manifest, setManifest] = useState<
    Map<string, { description?: string; duration?: number; width?: number; height?: number }>
  >(new Map());

  // Projects whose media manifest 404'd — most don't have one. Cache the miss so
  // we don't re-fetch (and spam the console) on every re-render; the effect was
  // also keyed on the `assets` array reference, which changes each render, so it
  // re-fired constantly. Key on a stable join + skip known-missing manifests.
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

  const handleImport = useCallback(
    async (files: FileList) => {
      if (!onImport) return;
      setImporting(true);
      try {
        await onImport(files);
      } finally {
        setImporting(false);
      }
    },
    [onImport],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) void handleImport(e.dataTransfer.files);
    },
    [handleImport],
  );

  const handleCopyPath = useCallback(async (path: string) => {
    const copied = await copyTextToClipboard(path);
    setCopyFeedback({ path, ok: copied });
    setTimeout(() => setCopyFeedback(null), copied ? 1500 : 3000);
  }, []);

  const elements = usePlayerStore((s) => s.elements);
  const usedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const el of elements) {
      if (el.src) {
        const src = el.src.replace(/^\/api\/projects\/[^/]+\/preview\//, "");
        paths.add(src);
      }
    }
    return paths;
  }, [elements]);

  // Unfiltered pool — header controls (search, chips) are gated on THIS, not
  // the search-filtered list, so a no-match query can't unmount its own input.
  const allMediaAssets = useMemo(
    () => assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a)),
    [assets],
  );

  const mediaAssets = useMemo(() => {
    if (!searchQuery) return allMediaAssets;
    const q = searchQuery.toLowerCase();
    return allMediaAssets.filter((a) => {
      if (basename(a).toLowerCase().includes(q)) return true;
      const rec = manifest.get(a);
      return rec?.description?.toLowerCase().includes(q);
    });
  }, [allMediaAssets, searchQuery, manifest]);

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
        {/* Import */}
        {onImport && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-panel-input px-3 py-[7px] text-[11px] font-medium text-panel-text-3 enabled:hover:text-panel-text-1 enabled:active:scale-[0.98] disabled:opacity-60 transition-colors mb-2.5"
            >
              {importing ? (
                <svg
                  className="animate-spin"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
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
              )}
              {importing ? "Importing…" : "Import media"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*,audio/*,font/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  void handleImport(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </>
        )}

        {/* Search — gated on the UNFILTERED pool so it never unmounts itself */}
        {allMediaAssets.length > 0 && (
          <SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search assets..."
            aria-label="Search assets"
            className="mb-2"
          />
        )}

        {/* Filter chips — panel-input style */}
        {allMediaAssets.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveFilter("all")}
              aria-pressed={activeFilter === "all"}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors active:scale-[0.98] ${
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
                  aria-pressed={activeFilter === cat}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors active:scale-[0.98] ${
                    activeFilter === cat
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  {CATEGORY_LABELS[cat]} {counts[cat]}
                </button>
              ) : null,
            )}
          </div>
        )}
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto mt-1">
        {mediaAssets.length === 0 && searchQuery ? (
          // Searched-empty: the filter caused the emptiness — say so and offer a way out.
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <p className="text-[11px] text-neutral-500 text-center">
              No assets match &ldquo;{searchQuery}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-panel-input text-panel-text-3 hover:text-panel-text-1 active:scale-[0.98] transition-colors"
            >
              Clear search
            </button>
          </div>
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
                    copyFeedback={copyFeedback}
                    onDelete={onDelete}
                    onRename={onRename}
                  />
                ))}
              {(cat === "images" || cat === "video") &&
                categorized[cat].map((a) => (
                  <ImageCard
                    key={a}
                    projectId={projectId}
                    asset={a}
                    used={usedPaths.has(a)}
                    onCopy={handleCopyPath}
                    copyFeedback={copyFeedback}
                    onDelete={onDelete}
                    onRename={onRename}
                    size={categorized[cat].length <= 4 ? "large" : "small"}
                  />
                ))}
              {cat === "fonts" &&
                categorized[cat].map((a) => (
                  <ImageCard
                    key={a}
                    projectId={projectId}
                    asset={a}
                    used={usedPaths.has(a)}
                    onCopy={handleCopyPath}
                    copyFeedback={copyFeedback}
                    onDelete={onDelete}
                    onRename={onRename}
                    size="small"
                  />
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
